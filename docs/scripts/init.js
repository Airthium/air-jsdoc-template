// Materialize CSS
let init = true
const initCollapsibles = () => {
  try {
    const indices = JSON.parse(localStorage.getItem('collapsiblesOpened'))
    const collapsibles = document.querySelectorAll('.collapsible')

    for (let index of indices) {
      const collapsible = collapsibles[index.ul]
      const instance = M.Collapsible.getInstance(collapsible)
      instance.open(index.li)
    }

    init = false
  } catch (err) {
    console.error('Collapsible elements initialization error')
    console.error(err)
    init = false
  }
}

const onCollapseOpenClose = () => {
  if (init) return

  const indices = []
  const collapsibles = document.querySelectorAll('.collapsible')

  for (let i = 0; i < collapsibles.length; ++i) {
    const collapsible = collapsibles[i]
    const items = collapsible.querySelectorAll('li')
    for (let j = 0; j < items.length; ++j) {
      const item = items[j]
      if (item.classList.contains('active'))
        indices.push({
          ul: i,
          li: j
        })
    }
  }

  localStorage.setItem('collapsiblesOpened', JSON.stringify(indices))
}

document.addEventListener('DOMContentLoaded', function () {
  const sidenavs = document.querySelectorAll('.sidenav')
  M.Sidenav.init(sidenavs)

  const collapsibles = document.querySelectorAll('.collapsible')
  M.Collapsible.init(collapsibles, {
    onOpenEnd: onCollapseOpenClose,
    onCloseEnd: onCollapseOpenClose
  })
  initCollapsibles()
})

// Highlightjs
hljs.initLineNumbersOnLoad()
hljs.highlightAll()
