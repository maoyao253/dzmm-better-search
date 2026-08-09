chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('search.html') });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'open-search') {
    chrome.tabs.create({ url: chrome.runtime.getURL('search.html') });
    sendResponse({ ok: true });
  }
  if (msg && msg.type === 'open-competition') {
    chrome.tabs.create({ url: chrome.runtime.getURL('competition.html') });
    sendResponse({ ok: true });
  }
});
