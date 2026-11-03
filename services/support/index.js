// ============================================================================
// Website Support & Tickets System — Module Exports
// ============================================================================

const {
  REASONS,
  PREFERENCES,
  CONTACT_OPTIONS,
  RESOLUTION_TYPES,
  checkEligibility,
  buildCatalog
} = require('./catalog');

const {
  normalizePhone,
  last10Digits,
  generateTicketNumber,
  deriveGroup,
  createSupportService
} = require('./SupportService');

const {
  createSupportSync
} = require('./SupportSync');

module.exports = {
  REASONS,
  PREFERENCES,
  CONTACT_OPTIONS,
  RESOLUTION_TYPES,
  checkEligibility,
  buildCatalog,
  normalizePhone,
  last10Digits,
  generateTicketNumber,
  deriveGroup,
  createSupportService,
  createSupportSync
};
