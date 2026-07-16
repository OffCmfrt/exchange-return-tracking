const fs = require('fs');
const path = 'd:/projects/OFFCOMFRT OFFCIAL/OFFCOMFRT/exchange-return-tracking-main/exchange-return-tracking-main/public/page.influencer-admin.liquid';
let content = fs.readFileSync(path, 'utf8');

// Remove the static edit modal HTML (no longer used - created dynamically)
const editModalStart = content.indexOf('<div id="iaEditModal"');
const statsModalStart = content.indexOf('<div id="iaStatsModal"');

if (editModalStart !== -1 && statsModalStart !== -1) {
  // Find the closing of the overlay div (go back from iaStatsModal to find the </div> that closes iaEditModal's overlay)
  let searchArea = content.substring(0, statsModalStart);
  // The edit modal overlay starts with <div id="iaEditModal" class="ia-modal-overlay"
  // We need to find its closing </div>
  let idx = editModalStart;
  let depth = 0;
  let inTag = false;
  let endIdx = idx;
  for (let i = idx; i < searchArea.length; i++) {
    if (searchArea[i] === '<' && searchArea[i+1] === 'd' && searchArea.substring(i, i+5) === '<div ') {
      depth++;
    }
    if (searchArea[i] === '<' && searchArea.substring(i, i+7) === '</div>') {
      depth--;
      if (depth === 0) {
        endIdx = i + 7; // include </div>
        break;
      }
    }
  }
  
  const removed = content.substring(editModalStart, endIdx);
  const removedSize = Buffer.byteLength(removed);
  console.log(`Removing edit modal HTML: ${removedSize} bytes`);
  
  content = content.substring(0, editModalStart) + content.substring(endIdx);
  
  console.log(`New file size: ${Buffer.byteLength(content)} bytes`);
  console.log(`Target: 256000 bytes`);
  console.log(`Remaining over: ${Buffer.byteLength(content) - 256000} bytes`);
  
  fs.writeFileSync(path, content, 'utf8');
  console.log('File updated!');
} else {
  console.log('Edit modal start:', editModalStart);
  console.log('Stats modal start:', statsModalStart);
}
