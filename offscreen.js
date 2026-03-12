async function readClipboard() {
  try {
    if (navigator.clipboard && navigator.clipboard.readText) {
      const text = await navigator.clipboard.readText()
      return text || ''
    }
  } catch (e) {
    // fall through to execCommand
  }

  const sandbox = document.getElementById('sandbox')
  sandbox.value = ''
  sandbox.select()
  let result = ''
  try {
    if (document.execCommand('paste')) {
      result = sandbox.value || ''
    }
  } catch (e) {
    result = ''
  }
  sandbox.value = ''
  return result
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request && request.type === 'clipboard-offscreen') {
    readClipboard().then((text) => {
      sendResponse({ clipboard: text })
    })
    return true
  }
})
