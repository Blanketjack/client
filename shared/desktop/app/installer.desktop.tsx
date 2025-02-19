import * as SafeElectron from '../../util/safe-electron.desktop'
import fs from 'fs'
import path from 'path'
import exec from './exec.desktop'
import {keybaseBinPath} from './paths.desktop'
import {quit} from './ctl.desktop'
import {isDarwin} from '../../constants/platform'
import logger from '../../logger'
import zlib from 'zlib'
import type {TypedActions} from '../../actions/typed-actions-gen'
import * as FsGen from '../../actions/fs-gen'

const file = path.join(SafeElectron.getApp().getPath('userData'), 'installer.json')

const loadHasPrompted = () => {
  try {
    const data = fs.readFileSync(file, 'utf8')
    return JSON.parse(data)?.promptedForCLI
  } catch (error_) {
    const error = error_ as {code?: string} | undefined
    if (error?.code === 'ENOENT') {
      console.log('[Installer] loadHasPrompted: No installer.json file')
    } else {
      console.warn('[Installer] loadHasPrompted: Error loading state:', error)
    }
    return false
  }
}

const saveHasPrompted = () => {
  try {
    fs.writeFileSync(file, JSON.stringify({promptedForCLI: true}))
  } catch (err) {
    console.warn('[Installer] saveHasPrompted: Error saving state:', err)
  }
}

type ErrorTypes = {
  cli: boolean
  fuse: boolean
  kbnm: boolean
}

type ResultType =
  | {
      componentResults?: Array<{
        status?: {
          code?: number
          desc?: string
        }
        name?: string
        exitCode?: number
      }>
    }
  | undefined

const checkErrors = (
  dispatch: (action: TypedActions) => void,
  result: ResultType,
  errors: Array<string>,
  errorTypes: ErrorTypes
) => {
  // Copied from old constants/favorite.js
  // See Installer.m: KBExitFuseKextError
  const ExitCodeFuseKextError = 4
  // See Installer.m: KBExitFuseKextPermissionError
  const ExitCodeFuseKextPermissionError = 5
  // See Installer.m: KBExitAuthCanceledError
  const ExitCodeAuthCanceledError = 6
  // See Installer.m: KBExitFuseCriticalUpdate
  const ExitFuseCriticalUpdate = 8
  // See install_darwin.go: exitCodeFuseCriticalUpdateFailed
  const ExitFuseCriticalUpdateFailed = 300

  const results = result?.componentResults || []
  results.forEach(cr => {
    if (cr.status?.code === 0) {
      return
    }
    if (cr.name === 'fuse') {
      errorTypes.fuse = true
      if (cr.exitCode === ExitCodeFuseKextError) {
        errors.push(
          `We were unable to load KBFS (Fuse kext). This may be due to a limitation in MacOS where there aren't any device slots available. Device slots can be taken up by apps such as VMWare, VirtualBox, anti-virus programs, VPN programs and Intel HAXM.`
        )
      } else if (cr.exitCode === ExitCodeFuseKextPermissionError) {
        // This will occur if they started install and didn't allow the extension in >= 10.13, and then restarted the app.
        // The app will deal with this scenario in the folders tab, so we can ignore this specific error here.
      }
    } else if (cr.name === 'helper' && cr.exitCode === ExitCodeAuthCanceledError) {
      // Consider this a FUSE error for the purpose of showing it to the user.
      errorTypes.fuse = true
      errors.push(
        `Installation was canceled. The file system will not be available until authorization is granted.`
      )
    } else if (cr.name === 'helper' && cr.exitCode === ExitFuseCriticalUpdate) {
      logger.info('[Installer] fuse critical update, setting badge')
      // ignore critical update error, it's just to coerce specific behavior in the Go installer
      dispatch(FsGen.createSetCriticalUpdate({val: true}))
      return
    } else if (cr.name === 'helper' && cr.exitCode === ExitFuseCriticalUpdateFailed) {
      errorTypes.fuse = true
      errors.push(
        `We were unable to perform required KBFS maintenance. This is likely because you are using KBFS mounts on more than one macOS system account on this computer. In order to fix this situation, please quit all running copies of Keybase on all accounts, and try starting Keybase again.`
      )
    } else if (cr.name === 'cli') {
      errorTypes.cli = true
    } else if (cr.name === 'redirector') {
      errorTypes.fuse = true
      errors.push(
        `We were unable to load the part of Keybase that lets you access your files in your file system. You should be able to do so if you wait a few minutes and restart Keybase.`
      )
    } else {
      errors.push(`There was an error trying to install the ${cr.name ?? ''}.`)
      errors.push(`\n${cr.status?.desc ?? ''}`)
      if (cr.name === 'kbnm') {
        errorTypes.kbnm = true
      }
    }
  })
}

type CB = (err: Error | null) => void
const darwinInstall = (dispatch: (action: TypedActions) => void, callback: CB) => {
  logger.info('[Installer]: Installer check starting now')
  const keybaseBin = keybaseBinPath()
  if (!keybaseBin) {
    callback(new Error('No keybase bin path'))
    return
  }
  let timeout = 30
  // If the app was opened at login, there might be contention for lots
  // of resources, so let's bump the install timeout to something large.
  if (SafeElectron.getApp().getLoginItemSettings().wasOpenedAtLogin) {
    timeout = 90
  }

  const logOutput = async (stdout: string, stderr: string) =>
    Promise.all([
      new Promise((resolve, reject) =>
        zlib.gzip(stdout, (error, res) => (error ? reject(error) : resolve(res)))
      ),
      new Promise((resolve, reject) =>
        zlib.gzip(stderr, (error, res) => (error ? reject(error) : resolve(res)))
      ),
    ])
      .then(([zStdout, zStderr]) =>
        logger.info(
          '[Installer]: got result from install-auto. To read, pipe the base64 strings to "| base64 -d | gzip -d".',
          // @ts-ignore codemode issue
          `stdout=${zStdout.toString('base64')}`,
          // @ts-ignore codemode issue
          `stderr=${zStderr.toString('base64')}`
        )
      )
      .catch(err => logger.error('[Installer]: Error zipping up logs: ', err))

  const handleResults = (err: {code: number} | undefined, _, stdout: string, stderr: string) => {
    const loggingPromise = logOutput(stdout, stderr)
    const errors: Array<string> = []
    const errorTypes: ErrorTypes = {
      cli: false,
      fuse: false,
      kbnm: false,
    }
    if (err) {
      errors.push(`There was an error trying to run the install (${err.code}).`)
    } else if (stdout !== '') {
      try {
        const result = JSON.parse(stdout) as ResultType
        if (result) {
          checkErrors(dispatch, result, errors, errorTypes)
        } else {
          errors.push(`There was an error trying to run the install. No output.`)
        }
      } catch (err) {
        errors.push(
          `There was an error trying to run the install. We were unable to parse the output of keybase install-auto.`
        )
      }
    }

    if (errors.length > 0) {
      logger.info(errors.join('\n'))
      logger.info('[Installer]: Install errorred')
      const buttons = errorTypes.fuse || errorTypes.kbnm ? ['Okay'] : ['Ignore', 'Quit']
      const detail = errors.join('\n') + `\n\nPlease run \`keybase log send\` to report the error.`
      const message = 'Keybase Install Error'
      loggingPromise
        .then(async () =>
          Electron.dialog.showMessageBox({buttons, detail, message}).then(({response}) => {
            if (response === 1) {
              quit()
            } else {
              callback(null)
            }
          })
        )
        .catch(() => {})
      return
    }

    // If we had an error install CLI, let's prompt and try to do it via privileged install.
    if (errorTypes.cli) {
      logger.info('[Installer]: Has cli errors and not installed yet, trying CLI install')
      if (loadHasPrompted()) {
        logger.info('[Installer]: Bailing on already tried to install cli previously')
      } else {
        saveHasPrompted()
        exec(
          keybaseBin,
          ['--debug', 'install', '--components=clipaths', '--format=json', '--timeout=120s'],
          'darwin',
          'prod',
          true,
          callback
        )
        return
      }
    }

    callback(null)
  }
  exec(
    keybaseBin,
    ['--debug', 'install-auto', '--format=json', `--timeout=${timeout}s`],
    'darwin',
    'prod',
    true,
    handleResults
  )
}

const install = isDarwin ? darwinInstall : (_: unknown, callback: CB) => callback(null) // nothing on other platforms
export default install
