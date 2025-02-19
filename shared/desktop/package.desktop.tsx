import rimraf from 'rimraf'
import fs from 'fs-extra'
import klawSync from 'klaw-sync'
import minimist from 'minimist'
import os from 'os'
import packager, {type Options} from 'electron-packager'
import path from 'path'
import webpack from 'webpack'
import rootConfig from './webpack.config.babel'

// absolute path relative to this script
const desktopPath = (...args: Array<string>) => path.join(__dirname, ...args)

// recursively copy a folder over and allow only files with the extensions passed as onlyExts
const copySyncFolder = (src: string, target: string, onlyExts: Array<string>) => {
  const srcRoot = desktopPath(src)
  const dstRoot = desktopPath(target)
  const files: Array<{path: string}> = klawSync(srcRoot, {
    filter: (item: {path: string}) => {
      const ext = path.extname(item.path)
      return !ext || onlyExts.includes(ext)
    },
  })
  const relSrcs = files.map(f => f.path.substr(srcRoot.length))
  const dsts = relSrcs.map(f => path.join(dstRoot, f))

  relSrcs.forEach((s, idx) => fs.copySync(path.join(srcRoot, s), dsts[idx]))
}

const copySync = (src, target, options?) => {
  fs.copySync(desktopPath(src), desktopPath(target), {...options, dereference: true})
}

const argv: {[key: string]: any} = minimist(process.argv.slice(2), {string: ['appVersion']})

const appName = 'Keybase'
const shouldUseAsar: boolean = argv.asar || argv.a || false
const shouldBuildAll: boolean = argv.all || false
const arch: string = argv.arch ? argv.arch.toString() : os.arch()
const platform: string = argv.platform ? argv.platform.toString() : os.platform()
const appVersion: string = argv.appVersion || '0.0.0'
const comment: string = argv.comment || ''
const outDir: string = argv.outDir || ''
const appCopyright = 'Copyright (c) 2022, Keybase'
const companyName = 'Keybase, Inc.'

const packagerOpts: Options = {
  appBundleId: 'keybase.Electron',
  appCopyright: appCopyright,
  appVersion: appVersion,
  asar: shouldUseAsar,
  buildVersion: String(appVersion) + String(comment),
  darwinDarkModeSupport: true,
  dir: desktopPath('./build'),
  download: {
    mirrorOptions: {
      mirror: 'https://kbelectron.keybase.pub/electron-download/',
    },
  },
  electronVersion: undefined,
  // macOS file association to saltpack files
  extendInfo: {
    CFBundleDocumentTypes: [
      {
        CFBundleTypeExtensions: ['saltpack'],
        CFBundleTypeIconFile: 'saltpack.icns',
        CFBundleTypeName: 'io.keybase.saltpack',
        CFBundleTypeRole: 'Editor',
        LSHandlerRank: 'Owner',
        LSItemContentTypes: ['io.keybase.saltpack'],
      },
    ],
    UTExportedTypeDeclarations: [
      {
        UTTypeConformsTo: ['public.data'],
        UTTypeDescription: 'Saltpack file format',
        UTTypeIconFile: 'saltpack.icns',
        UTTypeIdentifier: 'io.keybase.saltpack',
        UTTypeReferenceURL: 'https://saltpack.org',
        UTTypeTagSpecification: {
          'public.filename-extension': ['saltpack'],
        },
      },
    ],
  },
  // Any paths placed here will be moved to the final bundle
  extraResource: [] as Array<string>,
  helperBundleId: 'keybase.ElectronHelper',
  icon: undefined,
  ignore: [/\.map/, /\/test($|\/)/, /\/tools($|\/)/, /\/release($|\/)/, /\/node_modules($|\/)/],
  name: appName,
  protocols: [
    {
      name: 'Keybase',
      schemes: ['keybase', 'web+stellar'],
    },
  ],
}

function main() {
  rimraf.sync(desktopPath('dist'))
  rimraf.sync(desktopPath('build'))

  copySync('Icon.png', 'build/desktop/Icon.png')
  copySync('Icon@2x.png', 'build/desktop/Icon@2x.png')
  copySyncFolder('../images', 'build/images', ['.gif', '.png'])
  fs.removeSync(desktopPath('build/images/folders'))
  fs.removeSync(desktopPath('build/images/iconfont'))
  fs.removeSync(desktopPath('build/images/mock'))
  fs.removeSync(desktopPath('build/desktop/renderer/fonts'))

  fs.writeJsonSync(desktopPath('build/package.json'), {
    main: 'desktop/dist/node.bundle.js',
    name: appName,
    version: appVersion,
  })

  const icon: string = argv.icon
  const saltpackIcon: string = argv.saltpackIcon

  if (icon) {
    packagerOpts.icon = icon
  }

  if (saltpackIcon) {
    packagerOpts.extraResource = [saltpackIcon]
  } else {
    console.warn(
      `Missing 'saltpack.icns' from yarn package arguments. Need an icon to associate ".saltpack" files with Electron on macOS, Windows, and Linux.`
    )
  }

  // use the same version as the currently-installed electron
  console.log('Finding electron version')
  try {
    packagerOpts.electronVersion = require('../package.json').devDependencies.electron
    console.log('Found electron version:', packagerOpts.electronVersion)
  } catch (err) {
    console.log("Couldn't parse yarn list to find electron:", err)
    process.exit(1)
  }

  try {
    startPack()
  } catch (err) {
    console.log('Error startPack: ', err)
    process.exit(1)
  }
}

function startPack() {
  console.log('Starting webpack build\nInjecting __VERSION__: ', appVersion)
  process.env.APP_VERSION = appVersion
  const webpackConfig = rootConfig(null, {mode: 'production'})
  webpack(webpackConfig, (err, stats) => {
    if (err) {
      console.error(err)
      process.exit(1)
    }

    if (stats?.hasErrors()) {
      console.error(stats.toJson('errors-only').errors)
      process.exit(1)
    }

    copySyncFolder('./dist', 'build/desktop/sourcemaps', ['.map'])
    copySyncFolder('./dist', 'build/desktop/dist', ['.js', '.ttf', '.png', '.html'])
    fs.removeSync(desktopPath('build/desktop/dist/fonts'))

    rimraf.sync(desktopPath('release'))
    if (shouldBuildAll) {
      // build for all platforms
      const aps = [
        ['x64', 'darwin'],
        ['arm64', 'darwin'],
        ['ia32', 'linux'],
        ['x64', 'linux'],
        ['x64', 'win32'],
      ]
      aps.forEach(([arch, plat]) => {
        pack(plat, arch).then(postPack(plat, arch)).catch(postPackError)
      })
    } else {
      // build both on macos
      if (platform === 'darwin') {
        const aps = [
          ['x64', 'darwin'],
          ['arm64', 'darwin'],
        ]
        aps.forEach(([arch, plat]) => {
          pack(plat, arch).then(postPack(plat, arch)).catch(postPackError)
        })
      } else {
        pack(platform, arch).then(postPack(platform, arch)).catch(postPackError)
      }
    }
  })
}

// eslint-disable-next-line
function pack(plat: string, arch: string): Promise<any> {
  // there is no darwin ia32 electron
  if (plat === 'darwin' && arch === 'ia32') return Promise.resolve()

  let packageOutDir = outDir
  if (packageOutDir === '') packageOutDir = desktopPath(`release/${plat}-${arch}`)
  console.log('Packaging to', packageOutDir)

  let opts = {
    ...packagerOpts,
    arch,
    out: packageOutDir,
    platform: plat,
    prune: true,
  }

  if (plat === 'win32') {
    opts = {
      ...opts,
      // @ts-ignore does exist on win32
      'version-string': {
        CompanyName: companyName,
        FileDescription: appName,
        OriginalFilename: appName + '.exe',
        ProductName: appName,
      },
    }
  }

  return packager(opts)
}

const postPackError = err => {
  console.error(err)
  process.exit(1)
}

function postPack(plat, arch) {
  return appPaths => {
    if (!appPaths || appPaths.length === 0) {
      console.log(`${plat}-${arch} finished with no app bundles`)
      return
    }
    const subdir = plat === 'darwin' ? 'Keybase.app/Contents/Resources' : 'resources'
    const dir = path.join(appPaths[0], subdir, 'app/desktop/dist')
    const modules = ['node', 'main', 'tracker2', 'menubar', 'unlock-folders', 'pinentry']
    const files = [
      ...modules.map(p => p + '.bundle.js'),
      ...modules.filter(p => p !== 'node').map(p => p + '.html'),
    ]
    files.forEach(file => {
      try {
        const stats = fs.statSync(path.join(dir, file))
        if (!stats.isFile() && stats.size > 0) {
          console.error(`Detected a problem with packaging ${file}: ${stats.isFile()} ${stats.size}`)
          process.exit(1)
        }
      } catch (err) {
        console.error(`${path.join(dir, file)} doesn't exist`)
        console.error(err)
        process.exit(1)
      }
    })
    console.log(`${plat}-${arch} finished!`)
  }
}

main()
