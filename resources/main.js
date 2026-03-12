const jsonkey = 'jsonv'
const codeContainer = document.getElementById('jsoneditor-code')
const viewContainer = document.getElementById('jsoneditor-view')
const btnExpand = document.getElementById('btn-expand')
const btnCollapse = document.getElementById('btn-collapse')
const searchInput = document.getElementById('search-input')
const searchCount = document.getElementById('search-count')
const codeOptions = {
  mode: 'code',
  modes: ['code'], // keep left as input only
  onChange: () => {
    syncToView()
  },
}

const viewOptions = {
  mode: 'tree',
  modes: ['tree'],
  navigationBar: false,
  statusBar: false,
  mainMenuBar: false,
  search: false,
  onChange: () => {
    syncToCode()
  },
  onEvent: (info, event) => {
    if (!info || !info.path || !event || event.type !== 'click') return
    const target = event.target
    if (target && typeof target.closest === 'function') {
      const fieldCell = target.closest('.jsoneditor-field')
      if (fieldCell) {
        syncCursorToCode(info.path, 'field')
        return
      }
      const valueCell = target.closest('.jsoneditor-value')
      if (valueCell) {
        syncCursorToCode(info.path, 'value')
      }
    }
  },
}

const mode = window.location.search.substring(1)
const codeEditor = new JSONEditor(codeContainer, codeOptions)
const viewEditor = new JSONEditor(viewContainer, viewOptions)

let isSyncing = false
let lastSerialized = ''
let isCollapsed = false
let searchResults = []
let activeSearchIndex = 0
let activeSearchResult = null
let isFormatting = false

function pathToPointer(path) {
  if (!Array.isArray(path) || path.length === 0) return ''
  return '/' + path.map((p) => String(p).replace(/~/g, '~0').replace(/\//g, '~1')).join('/')
}

function buildStringifyMap(value) {
  let text = ''
  let line = 1
  let column = 1
  let offset = 0
  const mapValue = new Map()
  const mapField = new Map()
  const entries = []

  function advance(str) {
    const parts = str.split('\n')
    if (parts.length === 1) {
      column += str.length
    } else {
      line += parts.length - 1
      column = parts[parts.length - 1].length + 1
    }
    text += str
    offset += str.length
  }

  function recordValue(path) {
    const pointer = pathToPointer(path)
    if (pointer) {
      mapValue.set(pointer, { line, column, offset })
      entries.push({ pointer, path: path.slice(0), offset, kind: 'value' })
    }
  }

  function recordField(path) {
    const pointer = pathToPointer(path)
    if (pointer) {
      mapField.set(pointer, { line, column, offset })
      entries.push({ pointer, path: path.slice(0), offset, kind: 'field' })
    }
  }

  function writeValue(val, path, indent) {
    if (val === null || typeof val !== 'object') {
      recordValue(path)
      advance(JSON.stringify(val))
      return
    }

    if (Array.isArray(val)) {
      advance('[')
      if (val.length > 0) {
        advance('\n')
        for (let i = 0; i < val.length; i++) {
          advance(' '.repeat(indent + 2))
          recordValue(path.concat(i))
          writeValue(val[i], path.concat(i), indent + 2)
          if (i < val.length - 1) {
            advance(',')
          }
          advance('\n')
        }
        advance(' '.repeat(indent))
      }
      advance(']')
      return
    }

    const keys = Object.keys(val)
    advance('{')
    if (keys.length > 0) {
      advance('\n')
      keys.forEach((key, index) => {
        advance(' '.repeat(indent + 2))
        const keyText = JSON.stringify(key)
        recordField(path.concat(key))
        advance(keyText + ': ')
        recordValue(path.concat(key))
        writeValue(val[key], path.concat(key), indent + 2)
        if (index < keys.length - 1) {
          advance(',')
        }
        advance('\n')
      })
      advance(' '.repeat(indent))
    }
    advance('}')
  }

  writeValue(value, [], 0)
  entries.sort((a, b) => a.offset - b.offset)
  return { text, mapValue, mapField, entries }
}

function serialize(value) {
  try {
    return JSON.stringify(value)
  } catch (e) {
    return ''
  }
}

function syncToView() {
  if (isSyncing) return
  try {
    const text = codeEditor.getText()
    const value = JSON.parse(text)
    const serialized = serialize(value)
    if (!serialized || serialized === lastSerialized) return
    isSyncing = true
    viewEditor.update(value)
    lastSerialized = serialized
    try {
      localforage.setItem(jsonkey, value)
    } catch (e) {}
  } catch (e) {
    // invalid JSON in code editor; keep right pane unchanged
  } finally {
    isSyncing = false
  }
}

function syncToCode() {
  if (isSyncing) return
  try {
    const value = viewEditor.get()
    const serialized = serialize(value)
    if (!serialized || serialized === lastSerialized) return
    isSyncing = true
    const mapped = buildStringifyMap(value)
    codeEditor.setText(mapped.text)
    lastSerialized = serialized
  } catch (e) {
    // ignore
  } finally {
    isSyncing = false
  }
}

function syncCursorToCode(path, kind) {
  try {
    const value = viewEditor.get()
    const mapped = buildStringifyMap(value)
    const pointer = pathToPointer(path)
    let pos = kind === 'field' ? mapped.mapField.get(pointer) : mapped.mapValue.get(pointer)
    if (!pos) {
      pos = mapped.mapValue.get(pointer) || mapped.mapField.get(pointer)
    }
    const currentText = codeEditor.getText()
    if (currentText !== mapped.text) {
      isSyncing = true
      codeEditor.setText(mapped.text)
      isSyncing = false
    }
    if (pos && typeof codeEditor.setTextSelection === 'function') {
      if (codeEditor.aceEditor && codeEditor.aceEditor.session && codeEditor.aceEditor.session.doc) {
        const acePos = codeEditor.aceEditor.session.doc.indexToPosition(pos.offset, 0)
        codeEditor.setTextSelection(
          { row: acePos.row + 1, column: acePos.column + 1 },
          { row: acePos.row + 1, column: acePos.column + 1 }
        )
      } else {
        codeEditor.setTextSelection(pos, pos)
      }
    }
  } catch (e) {}
}

let isSyncingSelection = false
let leftSelectionTimer = null

function syncCursorToView() {
  if (isSyncingSelection) return
  if (!codeEditor.aceEditor || !codeEditor.aceEditor.session) return
  try {
    const text = codeEditor.getText()
    const value = JSON.parse(text)
    const mapped = buildStringifyMap(value)
    const pos = codeEditor.aceEditor.getCursorPosition()
    const offset = codeEditor.aceEditor.session.doc.positionToIndex(pos, 0)
    const entries = mapped.entries
    if (!entries.length) return
    let lo = 0
    let hi = entries.length - 1
    let best = entries[0]
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const cur = entries[mid]
      if (cur.offset <= offset) {
        best = cur
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    if (best && best.path) {
      isSyncingSelection = true
      viewEditor.setSelection({ path: best.path }, { path: best.path })
      try {
        const node = viewEditor.node && viewEditor.node.findNodeByPath(best.path)
        if (node) {
          if (typeof node.expandPathToNode === 'function') {
            node.expandPathToNode()
          }
          if (typeof node.scrollTo === 'function') {
            node.scrollTo()
          }
        }
      } catch (e) {}
      isSyncingSelection = false
    }
  } catch (e) {}
}

function formatCodeIfValid() {
  if (isFormatting) return
  try {
    const text = codeEditor.getText()
    const value = JSON.parse(text)
    const formatted = JSON.stringify(value, null, 2)
    if (formatted === text) return
    isFormatting = true
    codeEditor.setText(formatted)
  } catch (e) {
    // ignore invalid JSON
  } finally {
    isFormatting = false
  }
}

async function init() {
  let json = ''
  try {
    try{
      // 获取url后面的json字符串
      if (!mode || mode == '') {
        json = await localforage.getItem(jsonkey) || json
      } else if ('none' == mode) {
        json = ''
      } else if ('clipboard' == mode) {
        const clipText = await readClipboardText()
        if (clipText) {
          json = clipText
          try {
            const value = JSON.parse(json)
            const mapped = buildStringifyMap(value)
            codeEditor.setText(mapped.text)
            viewEditor.set(value)
            lastSerialized = serialize(value)
          } catch (e) {
            if (typeof toast === 'function') {
              toast('warn', '剪贴板不是合法 JSON')
            }
          }
        } else {
          if (typeof toast === 'function') {
            toast('warn', '无法自动读取剪贴板，请手动粘贴')
          }
        }
        return
      }
    }catch(e) {
     json = await localforage.getItem(jsonkey) || json
    }
  } catch (e) { }
  if (json) { 
    if (typeof json === 'string') {
      try {
        const value = JSON.parse(json)
        const mapped = buildStringifyMap(value)
        codeEditor.setText(mapped.text)
        viewEditor.set(value)
        lastSerialized = serialize(value)
      } catch (e) {
        codeEditor.setText(json)
      }
    } else {
      const mapped = buildStringifyMap(json)
      codeEditor.setText(mapped.text)
      viewEditor.set(json)
      lastSerialized = serialize(json)
    }
  } else {
    codeEditor.setText(json)
  }
}
init()

codeEditor.focus()
// 设置JSONEditor实例
window.JSONEditorInstance = codeEditor

if (codeEditor.aceEditor) {
  codeEditor.aceEditor.on('paste', () => {
    setTimeout(() => {
      formatCodeIfValid()
    }, 0)
  })
  codeEditor.aceEditor.on('changeSelection', () => {
    if (leftSelectionTimer) clearTimeout(leftSelectionTimer)
    leftSelectionTimer = setTimeout(() => {
      syncCursorToView()
    }, 80)
  })
}

async function readClipboardText() {
  try {
    if (navigator.clipboard && navigator.clipboard.readText) {
      const text = await navigator.clipboard.readText()
      if (text) return text
    }
  } catch (e) {}

  try {
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'clipboard' }, (resp) => resolve(resp || { clipboard: '' }))
    })
    if (response && response.clipboard) {
      return response.clipboard
    }
  } catch (e) {}

  try {
    const helper = document.createElement('textarea')
    helper.value = ''
    helper.style.position = 'fixed'
    helper.style.left = '-9999px'
    document.body.appendChild(helper)
    helper.focus()
    helper.select()
    let text = ''
    if (document.execCommand('paste')) {
      text = helper.value || ''
    }
    document.body.removeChild(helper)
    if (text) return text
  } catch (e) {}

  return ''
}

function installCustomMenuButtons() {
  if (!codeContainer) return
  const menu = codeContainer.querySelector('.jsoneditor-menu')
  if (!menu) return

  menu.querySelectorAll('.jsoneditor-copy, .jsoneditor-escape, .jsoneditor-repair-override')
    .forEach((node) => {
      const parent = node.parentNode
      if (parent && parent.classList && parent.classList.contains('jsoneditor-modes')) {
        parent.remove()
      } else if (node.remove) {
        node.remove()
      }
    })

  const anchorBtn = Array.from(menu.querySelectorAll('button')).find(
    (btn) => btn.textContent.trim() === 'T-'
  )
  let anchorFrame = anchorBtn ? anchorBtn.parentNode : null

  function appendBtn(text, className, title, onClick) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = `jsoneditor-modes jsoneditor-separator ${className}`
    btn.textContent = text
    btn.title = title
    btn.disabled = false
    btn.addEventListener('click', onClick)

    const frame = document.createElement('div')
    frame.className = 'jsoneditor-modes'
    frame.style.position = 'relative'
    frame.appendChild(btn)

    if (anchorFrame && anchorFrame.parentNode) {
      anchorFrame.parentNode.insertBefore(frame, anchorFrame.nextSibling)
      anchorFrame = frame
    } else {
      menu.appendChild(frame)
    }
    return btn
  }

  appendBtn('复制', 'jsoneditor-copy', '复制', async () => {
    const text = codeEditor.getText()
    try {
      await navigator.clipboard.writeText(text)
      if (typeof toast === 'function') toast('good', '复制成功')
    } catch (e) {
      const helper = document.createElement('textarea')
      helper.value = text
      document.body.appendChild(helper)
      helper.select()
      document.execCommand('copy')
      document.body.removeChild(helper)
      if (typeof toast === 'function') toast('good', '复制成功')
    }
  })

  appendBtn('转义', 'jsoneditor-escape', '转义', () => {
    const text = codeEditor.getText()
    const escaped = escapeOnce(text)
    isSyncing = true
    codeEditor.setText(escaped)
    isSyncing = false
    if (typeof toast === 'function') toast('good', '已转义')
  })

  appendBtn('去除转义', 'jsoneditor-repair-override', '去除一层转义', () => {
    const text = codeEditor.getText()
    const result = unescapeOnce(text)
    if (result == null) return
    isSyncing = true
    codeEditor.setText(result)
    isSyncing = false
    if (typeof toast === 'function') toast('good', '已去除一层转义')
  })
}

try {
  installCustomMenuButtons()
  setTimeout(installCustomMenuButtons, 0)
  setTimeout(installCustomMenuButtons, 300)
  let installTries = 0
  const installTimer = setInterval(() => {
    installTries += 1
    installCustomMenuButtons()
    const menu = codeContainer && codeContainer.querySelector('.jsoneditor-menu')
    const hasCopy = menu && menu.querySelector('.jsoneditor-copy')
    if (hasCopy || installTries > 20) {
      clearInterval(installTimer)
    }
  }, 200)
} catch (e) {}

function escapeOnce(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
}

function unescapeOnce(text) {
  if (text == null) return null
  return String(text)
    .replace(/\\\\/g, '\\')
    .replace(/\\"/g, '"')
}

//加载时设置默认字体大小
var font = parseInt(localStorage.getItem('jsonedit_fontsize'));
if (font < 0) {
	font = 15;
  localStorage.setItem('jsonedit_fontsize', font);
}
document.querySelectorAll('.ace_editor').forEach((node) => {
  node.style.fontSize = font + 'px'
})

function clearActiveSearch() {
  if (activeSearchResult) {
    const prevNode = activeSearchResult.node
    const prevElem = activeSearchResult.elem
    if (prevElem === 'field') {
      delete prevNode.searchFieldActive
    } else {
      delete prevNode.searchValueActive
    }
    prevNode.updateDom()
  }
  activeSearchResult = null
}

function setActiveSearch(index) {
  clearActiveSearch()
  if (!searchResults || !searchResults[index]) return
  activeSearchIndex = index
  const result = searchResults[index]
  const node = result.node
  if (result.elem === 'field') {
    node.searchFieldActive = true
  } else {
    node.searchValueActive = true
  }
  activeSearchResult = result
  node.updateDom()
  node.scrollTo()
}

function updateSearchCount() {
  if (!searchCount) return
  if (!searchResults || searchResults.length === 0) {
    searchCount.textContent = ''
  } else {
    searchCount.textContent = `${searchResults.length} 个结果`
  }
}

function performSearch(text) {
  const query = text && text.trim() ? text.trim() : undefined
  searchResults = viewEditor.search(query)
  updateSearchCount()
  if (query && isCollapsed && searchResults.length) {
    searchResults.forEach((result) => {
      if (result && result.node && typeof result.node.expandPathToNode === 'function') {
        result.node.expandPathToNode()
      }
    })
    isCollapsed = false
  }
  if (searchResults.length) {
    setActiveSearch(0)
  } else {
    clearActiveSearch()
  }
}

function nextSearchResult() {
  if (!searchResults || searchResults.length === 0) return
  const nextIndex = (activeSearchIndex + 1) % searchResults.length
  setActiveSearch(nextIndex)
}

if (btnExpand) {
  btnExpand.addEventListener('click', () => {
    viewEditor.expandAll()
    isCollapsed = false
  })
}

if (btnCollapse) {
  btnCollapse.addEventListener('click', () => {
    viewEditor.collapseAll()
    isCollapsed = true
  })
}

if (searchInput) {
  searchInput.addEventListener('input', (e) => {
    performSearch(e.target.value)
  })
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      nextSearchResult()
    }
  })
}
