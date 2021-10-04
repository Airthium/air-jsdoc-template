const _ = require('lodash')
const commonPathPrefix = require('common-path-prefix')
const env = require('jsdoc/env')
const fs = require('fs')
const helper = require('jsdoc/util/templateHelper')
const { log } = require('@jsdoc/util')
const { lsSync } = require('@jsdoc/util').fs
const path = require('path')
const { taffy } = require('taffydb')
const template = require('jsdoc/template')

const htmlsafe = helper.htmlsafe
const linkto = helper.linkto
const resolveAuthorLinks = helper.resolveAuthorLinks
const hasOwnProp = Object.prototype.hasOwnProperty

const templateOptions = (env && env.conf && env.conf.templateOptions) || {}

let data
let view

let outdir = path.normalize(env.opts.destination)

const searchIndex = []
const searchEnabled =
  templateOptions.search === undefined ? true : templateOptions.search

function search() {
  return {
    enabled: searchEnabled,
    list: searchIndex
  }
}

function mkdirpSync(filepath) {
  return fs.mkdirSync(filepath, { recursive: true })
}

function copyFile(filePath) {
  const target = path.join(outdir, filePath)
  mkdirpSync(path.dirname(target))
  fs.copyFileSync(filePath, target)
}

function find(spec) {
  return helper.find(data, spec)
}

function getAncestorLinks(doclet) {
  return helper.getAncestorLinks(data, doclet)
}

function hashToLink(doclet, hash) {
  let url

  if (!/^(#.+)/.test(hash)) {
    return hash
  }

  url = helper.createLink(doclet)
  url = url.replace(/(#.+|$)/, hash)

  return `<a href="${url}">${hash}</a>`
}

function needsSignature({ kind, type, meta }) {
  let needsSig = false

  // function and class definitions always get a signature
  if (kind === 'function' || kind === 'class') {
    needsSig = true
  }
  // typedefs that contain functions get a signature, too
  else if (kind === 'typedef' && type && type.names && type.names.length) {
    for (let i = 0, l = type.names.length; i < l; i++) {
      if (type.names[i].toLowerCase() === 'function') {
        needsSig = true
        break
      }
    }
  }
  // and namespaces that are functions get a signature (but finding them is a
  // bit messy)
  else if (
    kind === 'namespace' &&
    meta &&
    meta.code &&
    meta.code.type &&
    meta.code.type.match(/[Ff]unction/)
  ) {
    needsSig = true
  }

  return needsSig
}

function getSignatureAttributes({ optional, nullable }) {
  const attributes = []

  if (optional) {
    attributes.push('opt')
  }

  if (nullable === true) {
    attributes.push('nullable')
  } else if (nullable === false) {
    attributes.push('non-null')
  }

  return attributes
}

function updateItemName(item) {
  const attributes = getSignatureAttributes(item)
  let itemName = item.name || ''

  if (item.variable) {
    itemName = `&hellip;${itemName}`
  }

  if (attributes && attributes.length) {
    itemName = `${itemName}<span class="signature-attributes">${attributes.join(
      ', '
    )}</span>`
  }

  return itemName
}

function addParamAttributes(params) {
  return params
    .filter(({ name }) => name && !name.includes('.'))
    .map(updateItemName)
}

function buildItemTypeStrings(item) {
  const types = []

  if (item && item.type && item.type.names) {
    item.type.names.forEach((name) => {
      types.push(linkto(name, htmlsafe(name)))
    })
  }

  return types
}

function buildAttribsString(attribs) {
  let attribsString = ''

  if (attribs && attribs.length) {
    htmlsafe(`(${attribs.join(', ')}) `)
  }

  return attribsString
}

function addNonParamAttributes(items) {
  let types = []

  items.forEach((item) => {
    types = types.concat(buildItemTypeStrings(item))
  })

  return types
}

function addSignatureParams(f) {
  const params = f.params ? addParamAttributes(f.params) : []

  f.signature = `${f.signature || ''}(${params.join(', ')})`
}

function addSignatureReturns(f) {
  const attribs = []
  let attribsString = ''
  let returnTypes = []
  let returnTypesString = ''
  const source = f.yields || f.returns

  // jam all the return-type attributes into an array. this could create odd results (for example,
  // if there are both nullable and non-nullable return types), but let's assume that most people
  // who use multiple @return tags aren't using Closure Compiler type annotations, and vice-versa.
  if (source) {
    source.forEach((item) => {
      helper.getAttribs(item).forEach((attrib) => {
        if (!attribs.includes(attrib)) {
          attribs.push(attrib)
        }
      })
    })

    attribsString = buildAttribsString(attribs)
  }

  if (source) {
    returnTypes = addNonParamAttributes(source)
  }
  if (returnTypes.length) {
    returnTypesString = ` &rarr; ${attribsString}{${returnTypes.join('|')}}`
  }

  f.signature =
    `<span class="signature">${f.signature || ''}</span>` +
    `<span class="type-signature">${returnTypesString}</span>`
}

function addSignatureTypes(f) {
  const types = f.type ? buildItemTypeStrings(f) : []

  f.signature =
    `${f.signature || ''}<span class="type-signature">` +
    `${types.length ? ` :${types.join('|')}` : ''}</span>`
}

function addAttribs(f) {
  const attribs = helper.getAttribs(f)
  const attribsString = buildAttribsString(attribs)

  f.attribs = `<span class="type-signature">${attribsString}</span>`
}

function shortenPaths(files, commonPrefix) {
  Object.keys(files).forEach((file) => {
    files[file].shortened = files[file].resolved
      .replace(commonPrefix, '')
      // always use forward slashes
      .replace(/\\/g, '/')
  })

  return files
}

function getPathFromDoclet({ meta }) {
  if (!meta) {
    return null
  }

  return meta.path && meta.path !== 'null'
    ? path.join(meta.path, meta.filename)
    : meta.filename
}

function generate(title, docs, filename, resolveLinks) {
  let docData
  let html
  let outpath

  resolveLinks = resolveLinks !== false

  docData = {
    env: env,
    title: title,
    docs: docs
  }

  outpath = path.join(outdir, filename)
  html = view.render('container.tmpl', docData)

  if (resolveLinks) {
    html = helper.resolveLinks(html) // turn {@link foo} into <a href="foodoc.html">foo</a>
  }

  fs.writeFileSync(outpath, html, 'utf8')
}

function generateSourceFiles(sourceFiles, encoding = 'utf8') {
  Object.keys(sourceFiles).forEach((file) => {
    let source
    // links are keyed to the shortened path in each doclet's `meta.shortpath` property
    const sourceOutfile = helper.getUniqueFilename(sourceFiles[file].shortened)

    helper.registerLink(sourceFiles[file].shortened, sourceOutfile)

    try {
      source = {
        kind: 'source',
        code: helper.htmlsafe(
          fs.readFileSync(sourceFiles[file].resolved, encoding)
        )
      }
    } catch (e) {
      log.error(`Error while generating source file ${file}: ${e.message}`)
    }

    generate(
      `Source: ${sourceFiles[file].shortened}`,
      [source],
      sourceOutfile,
      false
    )
  })
}

/**
 * Look for classes or functions with the same name as modules (which indicates that the module
 * exports only that class or function), then attach the classes or functions to the `module`
 * property of the appropriate module doclets. The name of each class or function is also updated
 * for display purposes. This function mutates the original arrays.
 *
 * @private
 * @param {Array.<module:jsdoc/doclet.Doclet>} doclets - The array of classes and functions to
 * check.
 * @param {Array.<module:jsdoc/doclet.Doclet>} modules - The array of module doclets to search.
 */
function attachModuleSymbols(doclets, modules) {
  const symbols = {}

  // build a lookup table
  doclets.forEach((symbol) => {
    symbols[symbol.longname] = symbols[symbol.longname] || []
    symbols[symbol.longname].push(symbol)
  })

  modules.forEach((module) => {
    if (symbols[module.longname]) {
      module.modules = symbols[module.longname]
        // Only show symbols that have a description. Make an exception for classes, because
        // we want to show the constructor-signature heading no matter what.
        .filter(({ description, kind }) => description || kind === 'class')
        .map((symbol) => {
          symbol = _.cloneDeep(symbol)

          if (symbol.kind === 'class' || symbol.kind === 'function') {
            symbol.name = `${symbol.name.replace('module:', '(require("')}"))`
          }

          return symbol
        })
    }
  })
}

function buildItemNav(item, itemsSeen, linktoFn) {
  const methods = find({ kind: 'function', memberof: item.longname })
  const children = item.children || []

  if (!hasOwnProp.call(item, 'longname')) {
    return '<li>' + linktoFn('', item.name) + '</li>'
  } else if (!hasOwnProp.call(itemsSeen, item.longname)) {
    let itemNav = '<li>'

    if (methods.length || children.length) {
      itemNav += '<div class="collapsible-header waves-effect waves-teal">'
      itemNav += '<i class="material-icons">expand_more</i>'
    } else {
      itemNav += '<div class="collapsible-header">'
    }

    const linkTitle = linktoFn(item.longname, item.name.replace(/^module:/, ''))
    itemNav += linkTitle

    itemNav += '</div>'

    if (searchEnabled)
      searchIndex.push(
        JSON.stringify({
          title: item.longname,
          link: linktoFn(item.longname, linkTitle, 'collection-item')
        })
      )

    if (methods.length || children.length) {
      itemNav += '<div class="collapsible-body">'
      itemNav += '<div class="force-indent">'
      itemNav += '<ul class="collapsible">'

      if (methods.length) {
        for (let method of methods) {
          itemNav += '<li>'
          itemNav += '<div class="collapsible-header">'
          itemNav += linkto(method.longname, method.name)
          itemNav += '</div>'
          itemNav += '</li>'

          if (searchEnabled)
            searchIndex.push(
              JSON.stringify({
                title: method.longname,
                link: linkto(method.longname, method.name, 'collection-item')
              })
            )
        }
      }

      if (children.length) {
        for (let child of children) {
          const subItemNav = buildItemNav(child, itemsSeen, linktoFn)

          itemNav += subItemNav
        }
      }

      itemNav += '</ul>'
      itemNav += '</div>'
      itemNav += '</div>'
    }

    itemNav += '</li>'

    itemsSeen[item.longname] = true

    return itemNav
  }
}

function buildMemberNav(items, itemHeading, itemsSeen, linktoFn) {
  if (!items.length) return ''

  // Pre-process children
  const itemsWithChildren = items
    .map((item) => {
      if (item.memberof) {
        const parent = items.find((i) => i.longname === item.memberof)
        if (parent) {
          parent.children = [...(parent.children || []), item]

          return
        }
      }
      return item
    })
    .filter((i) => i)

  const itemsNav = itemsWithChildren.map((item) =>
    buildItemNav(item, itemsSeen, linktoFn)
  )

  if (!itemsNav.length) return ''

  return (
    '<li>' +
    '<div class="collapsible-header waves-effect waves-teal">' +
    '<i class="material-icons">expand_more</i>' +
    itemHeading +
    '</div>' +
    '<div class="collapsible-body">' +
    '<div class="force-indent">' +
    '<ul class="collapsible">' +
    itemsNav.join('') +
    '</ul>' +
    '</div>' +
    '</div>' +
    '</li>'
  )
}

function linktoExternal(longName, name) {
  return linkto(longName, name.replace(/(^"|"$)/g, ''))
}

/**
 * Build nav title
 */
function buildNavTitle() {
  const iconPath = templateOptions.icon
  const title = templateOptions.title || 'Home'
  const subTitle = templateOptions.subTitle

  if (iconPath) {
    copyFile(iconPath)
  }

  let render = '<div class="card horizontal">'

  if (iconPath) {
    render += '<div class="card-image">'
    render += '<img alt="Home" src="' + iconPath + '" />'
    render += '</div>'
  }
  render += '<div class="card-stacked">'
  render += '<div class="card-content">'
  render += '<a href="index.html">' + title + '</a>'
  render += '</div>'

  if (subTitle) {
    render += '<div class="card-action">'
    render += subTitle
    render += '</div>'
  }

  render += '</div>'
  render += '</div>'

  return render
}

function buildNavAddons() {
  const menu = templateOptions.menu

  if (!menu) return

  if (!Array.isArray(menu)) log.warn('menu option must be an array')

  return menu
    .map(
      (m) =>
        '<li>' +
        '<div class="collapsible-header">' +
        '<a href="' +
        m.link +
        '" target="_blank" style="display: flex; align-items: center;">' +
        '<i class="small material-icons">link</i>' +
        m.label +
        '</a>' +
        '</div>' +
        '</li>'
    )
    .join('')
}

/**
 * Create the navigation sidebar.
 * @param {object} members The members that will be used to create the sidebar.
 * @param {array<object>} members.classes
 * @param {array<object>} members.externals
 * @param {array<object>} members.globals
 * @param {array<object>} members.mixins
 * @param {array<object>} members.modules
 * @param {array<object>} members.namespaces
 * @param {array<object>} members.events
 * @param {array<object>} members.interfaces
 * @return {string} The HTML for the navigation sidebar.
 */
function buildNav(members) {
  let globalNav
  let nav = '<ul class="collapsible">'
  const seen = {}

  nav += buildMemberNav(members.modules, 'Modules', {}, linkto)
  nav += buildMemberNav(members.externals, 'Externals', seen, linktoExternal)
  nav += buildMemberNav(members.namespaces, 'Namespaces', seen, linkto)
  nav += buildMemberNav(members.classes, 'Classes', seen, linkto)
  nav += buildMemberNav(members.interfaces, 'Interfaces', seen, linkto)
  nav += buildMemberNav(members.events, 'Events', seen, linkto)
  nav += buildMemberNav(members.mixins, 'Mixins', seen, linkto)

  if (members.globals.length) {
    globalNav = ''

    members.globals.forEach(({ kind, longname, name }) => {
      if (kind !== 'typedef' && !hasOwnProp.call(seen, longname)) {
        globalNav += `<li>${linkto(longname, name)}</li>`
      }
      seen[longname] = true
    })

    if (!globalNav) {
      // turn the heading into a link so you can actually get to the global page
      nav +=
        '<li>' +
        '<div class="collapsible-header waves-effect waves-teal">' +
        linkto('global', 'Global') +
        '</div>' +
        '</li>'
    } else {
      nav +=
        '<li>' +
        '<div class="collapsible-header waves-effect waves-teal">' +
        'Global' +
        '</div>' +
        '<div class="collapsible-body">' +
        '<div class="force-indent">' +
        '<ul>' +
        globalNav +
        '</ul>' +
        '</div>' +
        '</div>' +
        '</li>'
    }
  }

  nav += '</ul>'

  return nav
}

function sourceToDestination(parentDir, sourcePath, destDir) {
  const relativeSource = path.relative(parentDir, sourcePath)

  return path.resolve(path.join(destDir, relativeSource))
}

/**
    @param {TAFFY} taffyData See <http://taffydb.com/>.
    @param {object} opts
 */
exports.publish = (taffyData, opts) => {
  let classes
  let conf
  let cwd
  let externals
  let files
  let fromDir
  let globalUrl
  let indexUrl
  let interfaces
  let members
  let mixins
  let modules
  let namespaces
  let outputSourceFiles
  let packageInfo
  let packages
  const sourceFilePaths = []
  let sourceFiles = {}
  let staticFileFilter
  let staticFilePaths
  let staticFiles
  let staticFileScanner
  let templatePath

  data = taffyData

  conf = env.conf.templates || {}
  conf.default = conf.default || {}

  templatePath = path.normalize(opts.template)
  view = new template.Template(path.join(templatePath, 'tmpl'))

  // claim some special filenames in advance, so the All-Powerful Overseer of Filename Uniqueness
  // doesn't try to hand them out later
  indexUrl = helper.getUniqueFilename('index')
  // don't call registerLink() on this one! 'index' is also a valid longname

  globalUrl = helper.getUniqueFilename('global')
  helper.registerLink('global', globalUrl)

  // set up templating
  view.layout = conf.default.layoutFile
    ? path.resolve(conf.default.layoutFile)
    : 'layout.tmpl'

  data = helper.prune(data)
  data.sort('longname, version, since')
  helper.addEventListeners(data)

  data().each((doclet) => {
    let sourcePath

    doclet.attribs = ''

    if (doclet.examples) {
      doclet.examples = doclet.examples.map((example) => {
        let caption
        let code

        if (
          example.match(
            /^\s*<caption>([\s\S]+?)<\/caption>(\s*[\n\r])([\s\S]+)$/i
          )
        ) {
          caption = RegExp.$1
          code = RegExp.$3
        }

        return {
          caption: caption || '',
          code: code || example
        }
      })
    }
    if (doclet.see) {
      doclet.see.forEach((seeItem, i) => {
        doclet.see[i] = hashToLink(doclet, seeItem)
      })
    }

    // build a list of source files
    if (doclet.meta) {
      sourcePath = getPathFromDoclet(doclet)
      sourceFiles[sourcePath] = {
        resolved: sourcePath,
        shortened: null
      }
      if (!sourceFilePaths.includes(sourcePath)) {
        sourceFilePaths.push(sourcePath)
      }
    }
  })

  // update outdir if necessary, then create outdir
  packageInfo = (find({ kind: 'package' }) || [])[0]
  if (packageInfo && packageInfo.name) {
    outdir = path.join(outdir, packageInfo.name, packageInfo.version || '')
  }
  mkdirpSync(outdir)

  // copy the template's static files to outdir
  fromDir = path.join(templatePath, 'static')
  staticFiles = lsSync(fromDir)

  staticFiles.forEach((fileName) => {
    const toPath = sourceToDestination(fromDir, fileName, outdir)

    mkdirpSync(path.dirname(toPath))
    fs.copyFileSync(fileName, toPath)
  })

  // copy user-specified static files to outdir
  if (conf.default.staticFiles) {
    // The canonical property name is `include`. We accept `paths` for backwards compatibility
    // with a bug in JSDoc 3.2.x.
    staticFilePaths =
      conf.default.staticFiles.include || conf.default.staticFiles.paths || []
    staticFileFilter = new (require('jsdoc/src/filter').Filter)(
      conf.default.staticFiles
    )
    staticFileScanner = new (require('jsdoc/src/scanner').Scanner)()
    cwd = process.cwd()

    staticFilePaths.forEach((filePath) => {
      let extraStaticFiles

      filePath = path.resolve(cwd, filePath)
      extraStaticFiles = staticFileScanner.scan(
        [filePath],
        10,
        staticFileFilter
      )

      extraStaticFiles.forEach((fileName) => {
        const toPath = sourceToDestination(fromDir, fileName, outdir)

        mkdirpSync(path.dirname(toPath))
        fs.copyFileSync(fileName, toPath)
      })
    })
  }

  if (sourceFilePaths.length) {
    sourceFiles = shortenPaths(sourceFiles, commonPathPrefix(sourceFilePaths))
  }
  data().each((doclet) => {
    let docletPath
    const url = helper.createLink(doclet)

    helper.registerLink(doclet.longname, url)

    // add a shortened version of the full path
    if (doclet.meta) {
      docletPath = getPathFromDoclet(doclet)
      docletPath = sourceFiles[docletPath].shortened
      if (docletPath) {
        doclet.meta.shortpath = docletPath
      }
    }
  })

  data().each((doclet) => {
    const url = helper.longnameToUrl[doclet.longname]

    if (url.includes('#')) {
      doclet.id = helper.longnameToUrl[doclet.longname].split(/#/).pop()
    } else {
      doclet.id = doclet.name
    }

    if (needsSignature(doclet)) {
      addSignatureParams(doclet)
      addSignatureReturns(doclet)
      addAttribs(doclet)
    }
  })

  // do this after the urls have all been generated
  data().each((doclet) => {
    doclet.ancestors = getAncestorLinks(doclet)

    if (doclet.kind === 'member') {
      addSignatureTypes(doclet)
      addAttribs(doclet)
    }

    if (doclet.kind === 'constant') {
      addSignatureTypes(doclet)
      addAttribs(doclet)
      doclet.kind = 'member'
    }
  })

  members = helper.getMembers(data)

  // output pretty-printed source files by default
  outputSourceFiles = conf.default && conf.default.outputSourceFiles !== false

  // add template helpers
  view.find = find
  view.linkto = linkto
  view.resolveAuthorLinks = resolveAuthorLinks
  view.htmlsafe = htmlsafe
  view.outputSourceFiles = outputSourceFiles

  // Favicon
  if (templateOptions.favicon) {
    copyFile(templateOptions.favicon)
    view.favicon = templateOptions.favicon
  }

  // Nav title
  view.navTitle = buildNavTitle()

  // Nav addons
  view.navAddons = buildNavAddons()

  // Footer
  view.footer = templateOptions.footer

  // once for all
  view.nav = buildNav(members)
  attachModuleSymbols(find({ longname: { left: 'module:' } }), members.modules)

  // Search
  view.search = search()

  // generate the pretty-printed source files first so other pages can link to them
  if (outputSourceFiles) {
    generateSourceFiles(sourceFiles, opts.encoding)
  }

  if (members.globals.length) {
    generate('Global', [{ kind: 'globalobj' }], globalUrl)
  }

  // index page displays information from package.json and lists files
  files = find({ kind: 'file' })
  packages = find({ kind: 'package' })

  generate(
    'Home',
    packages
      .concat([
        {
          kind: 'mainpage',
          readme: opts.readme,
          longname: opts.mainpagetitle ? opts.mainpagetitle : 'Main Page'
        }
      ])
      .concat(files),
    indexUrl
  )

  // set up the lists that we'll use to generate pages
  classes = taffy(members.classes)
  modules = taffy(members.modules)
  namespaces = taffy(members.namespaces)
  mixins = taffy(members.mixins)
  externals = taffy(members.externals)
  interfaces = taffy(members.interfaces)

  Object.keys(helper.longnameToUrl).forEach((longname) => {
    const myClasses = helper.find(classes, { longname: longname })
    const myExternals = helper.find(externals, { longname: longname })
    const myInterfaces = helper.find(interfaces, { longname: longname })
    const myMixins = helper.find(mixins, { longname: longname })
    const myModules = helper.find(modules, { longname: longname })
    const myNamespaces = helper.find(namespaces, { longname: longname })

    if (myModules.length) {
      generate(
        `Module: ${myModules[0].name}`,
        myModules,
        helper.longnameToUrl[longname]
      )
    }

    if (myClasses.length) {
      generate(
        `Class: ${myClasses[0].name}`,
        myClasses,
        helper.longnameToUrl[longname]
      )
    }

    if (myNamespaces.length) {
      generate(
        `Namespace: ${myNamespaces[0].name}`,
        myNamespaces,
        helper.longnameToUrl[longname]
      )
    }

    if (myMixins.length) {
      generate(
        `Mixin: ${myMixins[0].name}`,
        myMixins,
        helper.longnameToUrl[longname]
      )
    }

    if (myExternals.length) {
      generate(
        `External: ${myExternals[0].name}`,
        myExternals,
        helper.longnameToUrl[longname]
      )
    }

    if (myInterfaces.length) {
      generate(
        `Interface: ${myInterfaces[0].name}`,
        myInterfaces,
        helper.longnameToUrl[longname]
      )
    }
  })
}
