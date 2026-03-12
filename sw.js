chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('index.html') })
})

async function ensureOffscreenDocument() {
  try {
    const hasDoc = await chrome.offscreen.hasDocument()
    if (hasDoc) return
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['CLIPBOARD_READ'],
      justification: 'Read clipboard to load JSON into editor'
    })
  } catch (e) {
    // ignore
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request && request.type === 'clipboard') {
    ensureOffscreenDocument().then(() => {
      chrome.runtime.sendMessage({ type: 'clipboard-offscreen' }, (response) => {
        sendResponse(response || { clipboard: '' })
      })
    }).catch(() => {
      sendResponse({ clipboard: '' })
    })
    return true
  }
})
