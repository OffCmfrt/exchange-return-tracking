// ============================================================================
// TransitionService — Validates state machines, never allows silent writes
// ----------------------------------------------------------------------------
// Rule (spec §05): Every transition is validated; nothing sets a status column
// directly. Illegal transitions return 422.
// ============================================================================

const supabase = require('../../config/supabase');

// State machine definitions — the ONLY legal transitions
const STATE_MACHINES = {
  influencer: {
    APPLIED:          ['SCREENING'],
    SCREENING:        ['REJECTED', 'ON_TRIAL'],
    REJECTED:         [],
    ON_TRIAL:         ['ACTIVE', 'TRIAL_LAPSED'],
    TRIAL_LAPSED:     ['ON_TRIAL', 'DISCHARGED'],  // ON_TRIAL = extension (once only)
    ACTIVE:           ['RESERVE', 'SUSPENDED'],
    RESERVE:          ['ACTIVE', 'DISCHARGED'],
    SUSPENDED:        ['ACTIVE', 'DISCHARGED'],
    DISCHARGED:       ['BLACKLISTED'],
    BLACKLISTED:      []
  },
  assignment: {
    ASSIGNED:           ['IN_PROGRESS', 'EXPIRED'],
    IN_PROGRESS:        ['SUBMITTED', 'EXPIRED'],
    SUBMITTED:          ['UNDER_REVIEW'],
    UNDER_REVIEW:       ['APPROVED', 'CHANGES_REQUESTED', 'REJECTED'],
    CHANGES_REQUESTED:  ['SUBMITTED'],
    APPROVED:           ['VERIFIED_LIVE', 'CLAWED_BACK'],
    VERIFIED_LIVE:      [],
    REJECTED:           [],
    EXPIRED:            [],
    CLAWED_BACK:        []
  },
  shipment_request: {
    REQUESTED:          ['APPROVED', 'CANCELLED'],
    APPROVED:           ['ADDRESS_CONFIRMED', 'CANCELLED'],
    ADDRESS_CONFIRMED:  ['PACKED', 'CANCELLED'],
    PACKED:             ['DISPATCHED'],
    DISPATCHED:         ['IN_TRANSIT'],
    IN_TRANSIT:         ['DELIVERED', 'NDR', 'LOST'],
    DELIVERED:          [],
    NDR:                ['RTO', 'DELIVERED', 'IN_TRANSIT'],
    RTO:                [],
    LOST:               [],
    CANCELLED:          []
  }
};

// Side effects per transition (executed after status change)
const SIDE_EFFECTS = {
  influencer: {
    'SCREENING->REJECTED': async (id) => {
      // Decline message (future: WhatsApp notification)
      console.log(`[Transition] Influencer ${id} rejected — send decline message`);
    },
    'SCREENING->ON_TRIAL': async (id) => {
      // Create influencer at ordinal 1, issue tokens, welcome message
      console.log(`[Transition] Influencer ${id} approved — create at CL5, issue tokens`);
    },
    'ON_TRIAL->ACTIVE': async (id) => {
      // Promote to ordinal 2
      console.log(`[Transition] Athlete ${id} trial complete — promote to CL4`);
    },
    'ACTIVE->RESERVE': async (id) => {
      // Deactivate code, pause seeding and commission, retain level
      console.log(`[Transition] Athlete ${id} -> Reserve — deactivate code, pause seeding`);
    },
    'RESERVE->ACTIVE': async (id) => {
      // Reactivate code, resume seeding
      console.log(`[Transition] Athlete ${id} reactivated — reactivate code`);
    },
    'ACTIVE->SUSPENDED': async (id) => {
      // Freeze assignments, disable code, retain level
      console.log(`[Transition] Athlete ${id} suspended — freeze assignments`);
    },
    'RESERVE->DISCHARGED': async (id) => {
      // Revoke tokens, delete code, freeze XP
      console.log(`[Transition] Athlete ${id} discharged — revoke tokens`);
    },
    'DISCHARGED->BLACKLISTED': async (id) => {
      // Reverse fraudulent XP, withhold commission, block re-application
      console.log(`[Transition] Athlete ${id} blacklisted — block re-application`);
    }
  },
  assignment: {
    'UNDER_REVIEW->APPROVED': async (id) => {
      // Award XP via ledger, apply on-time bonus, enqueue level eval
      console.log(`[Transition] Assignment ${id} approved — award XP`);
    },
    'APPROVED->CLAWED_BACK': async (id) => {
      // Reverse ledger entry, recompute standing, re-evaluate level
      console.log(`[Transition] Assignment ${id} clawed back — reverse XP`);
    }
  },
  shipment_request: {
    'IN_TRANSIT->DELIVERED': async (id) => {
      // Stamp delivered_at — starts trial clock
      console.log(`[Transition] Shipment request ${id} delivered — start trial clock`);
    }
  }
};

const TransitionService = {

  /**
   * Move an entity to a new state.
   * Validates against the state machine, executes side effects.
   *
   * @param {'influencer'|'assignment'|'shipment_request'} entityType
   * @param {number} id
   * @param {string} toState
   * @param {string} actor — who is making this change
   * @param {string} [reasonCode]
   * @returns {Promise<{success: boolean, from: string, to: string, sideEffects: string[]}>}
   */
  async move(entityType, id, toState, actor = 'system', reasonCode = null) {
    const machine = STATE_MACHINES[entityType];
    if (!machine) throw new Error(`Unknown entity type: ${entityType}`);

    // Determine the table and status column
    const tableMap = {
      influencer: { table: 'influencers', column: 'athlete_status' },
      assignment: { table: 'assignments', column: 'status' },
      shipment_request: { table: 'shipment_requests', column: 'status' }
    };

    const { table, column } = tableMap[entityType];

    // Fetch current state
    const { data: current, error } = await supabase
      .from(table)
      .select(`id, ${column}`)
      .eq('id', id)
      .single();

    if (error) throw error;
    if (!current) throw new Error(`${entityType} ${id} not found`);

    const fromState = current[column];

    // Validate transition
    const allowed = machine[fromState] || [];
    if (!allowed.includes(toState)) {
      const err = new Error(
        `Illegal transition: ${entityType} cannot go from ${fromState} to ${toState}. ` +
        `Allowed: [${allowed.join(', ')}]`
      );
      err.status = 422;
      throw err;
    }

    // Update status
    const updateData = { [column]: toState };

    // Add reviewed_at for assignment reviews
    if (entityType === 'assignment' && ['UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED'].includes(toState)) {
      updateData.reviewed_at = new Date().toISOString();
      updateData.reviewer_id = actor;
    }

    // Add reviewed fields for applications
    if (entityType === 'influencer' && ['REJECTED', 'ON_TRIAL'].includes(toState)) {
      updateData.reviewed_at = new Date().toISOString();
      updateData.reviewed_by = actor;
    }

    const { error: updateErr } = await supabase
      .from(table)
      .update(updateData)
      .eq('id', id);

    if (updateErr) throw updateErr;

    // Execute side effects
    const sideEffects = [];
    const effectKey = `${fromState}->${toState}`;
    const effects = SIDE_EFFECTS[entityType]?.[effectKey];

    if (effects) {
      try {
        await effects(id);
        sideEffects.push(effectKey);
      } catch (err) {
        console.error(`[TransitionService] Side effect failed for ${effectKey}:`, err);
        // Don't rollback — status is already changed, log for manual fix
      }
    }

    console.log(`[TransitionService] ${entityType} ${id}: ${fromState} -> ${toState} (by ${actor})`);

    return { success: true, from: fromState, to: toState, sideEffects };
  },

  /**
   * Get allowed transitions from current state.
   *
   * @param {'influencer'|'assignment'|'shipment_request'} entityType
   * @param {string} currentState
   * @returns {string[]}
   */
  getAllowedTransitions(entityType, currentState) {
    const machine = STATE_MACHINES[entityType];
    if (!machine) return [];
    return machine[currentState] || [];
  },

  /**
   * Get the full state machine definition.
   *
   * @param {'influencer'|'assignment'|'shipment_request'} entityType
   * @returns {object}
   */
  getStateMachine(entityType) {
    return STATE_MACHINES[entityType] || null;
  }
};

module.exports = TransitionService;
