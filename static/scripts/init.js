document.addEventListener('DOMContentLoaded', function () {
  var sidenavs = document.querySelectorAll('.sidenav')
  M.Sidenav.init(sidenavs)

  const collapsibles = document.querySelectorAll('.collapsible')
  M.Collapsible.init(collapsibles)
})
