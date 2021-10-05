const keys = ['title']
const defaultOptions = {
  shouldSort: true,
  threshold: 0.4,
  location: 0,
  distance: 100,
  maxPatternLength: 32,
  minPatternLength: 3,
  keys: keys
}

let fuseIndex
let fuse

function showSearchResults() {
  const results = document.getElementById('search-results')
  results.style.display = 'block'
}

function hideSearchResults() {
  const results = document.getElementById('search-results')
  results.style.display = 'none'
}

function search(value) {
  const resultsDiv = document.getElementById('search-results')

  const results = fuse.search(value)
  if (results.length > 20) results.splice(20, results.length - 20)

  if (results.length === 0) {
    resultsDiv.innerHTML = 'No result found'
  } else {
    resultsDiv.innerHTML = results.map((result) => result.item.link).join('')
  }
}

function afterFocus(e) {
  const id = e.target.id
  if (id !== 'search') {
    setTimeout(hideSearchResults, 60)

    window.removeEventListener('click', afterFocus)
  }
}

function initSearch(list) {
  const inputSearch = document.getElementById('search')

  fuseIndex = Fuse.createIndex(keys, list)
  fuse = new Fuse(list, defaultOptions, fuseIndex)

  inputSearch.addEventListener('keyup', function () {
    if (inputSearch.value !== '') {
      showSearchResults()
      search(inputSearch.value)
    } else {
      hideSearchResults()
    }
  })

  inputSearch.addEventListener('focus', function () {
    showSearchResults()
    if (inputSearch.value !== '') search(inputSearch.value)

    window.addEventListener('click', afterFocus)
  })
}
