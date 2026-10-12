'use strict';

// The agreement window: the round tick enables Continue.
window.createShiba(document.getElementById('shibaArt'), { scale: 3 }).setMood('hello');
const box = document.getElementById('agree');
const label = document.getElementById('agreeBox');
const button = document.getElementById('continue');

box.addEventListener('change', () => {
  label.classList.toggle('checked', box.checked);
  button.disabled = !box.checked;
});
button.addEventListener('click', () => { if (box.checked) window.notchman.agree(); });
document.getElementById('quit').addEventListener('click', () => window.notchman.quitApp());
// The links open the full documents in the browser (and don't tick the box).
for (const link of label.querySelectorAll('a')) {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    window.notchman.openLink(link.href);
  });
}

window.notchman.agreementInfo().then(({ community }) => {
  document.getElementById('rows').classList.toggle('gone', community);
  document.getElementById('communityRows').classList.toggle('gone', !community);
});
