import * as Container from '../../util/container'
import * as ProfileGen from '../profile-gen'
import * as RPCTypes from '../../constants/types/rpc-gen'
import * as Saga from '../../util/saga'
import {RPCError} from '../../util/errors'
import * as RouteTreeGen from '../route-tree-gen'
import {peopleTab} from '../../constants/tabs'

function* generatePgp(state: Container.TypedState) {
  let canceled = false

  const ids = [state.profile.pgpEmail1, state.profile.pgpEmail2, state.profile.pgpEmail3]
    .filter(Boolean)
    .map(email => ({
      comment: '',
      email: email || '',
      username: state.profile.pgpFullName || '',
    }))

  yield Saga.put(
    RouteTreeGen.createNavigateAppend({
      path: [peopleTab, 'profile', 'profilePgp', 'profileProvideInfo', 'profileGenerate'],
    })
  )
  // We allow the UI to cancel this call. Just stash this intention and nav away and response with an error to the rpc
  const cancelTask = yield Saga._fork(function* () {
    yield Saga.take(ProfileGen.cancelPgpGen)
    canceled = true
  })
  try {
    yield RPCTypes.pgpPgpKeyGenDefaultRpcSaga({
      customResponseIncomingCallMap: {
        'keybase.1.pgpUi.keyGenerated': ({key}, response) => {
          if (canceled) {
            response.error({code: RPCTypes.StatusCode.scinputcanceled, desc: 'Input canceled'})
            return undefined
          } else {
            response.result()
            return Saga.put(ProfileGen.createUpdatePgpPublicKey({publicKey: key.key}))
          }
        },
        'keybase.1.pgpUi.shouldPushPrivate': ({prompt}, response) => {
          return Saga.callUntyped(function* () {
            yield Saga.put(
              RouteTreeGen.createNavigateAppend({
                path: [
                  peopleTab,
                  'profile',
                  'profilePgp',
                  'profileProvideInfo',
                  'profileGenerate',
                  'profileFinished',
                ],
              })
            )
            yield Saga.put(
              ProfileGen.createUpdatePromptShouldStoreKeyOnServer({promptShouldStoreKeyOnServer: prompt})
            )
            const action: ProfileGen.FinishedWithKeyGenPayload = yield Saga.take(
              ProfileGen.finishedWithKeyGen
            )
            response.result(action.payload.shouldStoreKeyOnServer)
          })
        },
      },
      incomingCallMap: {'keybase.1.pgpUi.finished': () => {}},
      params: {createUids: {ids, useDefault: false}},
    })
  } catch (error_) {
    const error = error_ as RPCError
    // did we cancel?
    if (error.code !== RPCTypes.StatusCode.scinputcanceled) {
      throw error
    }
  }
  cancelTask.cancel()
}

function* pgpSaga(): Iterable<any> {
  yield* Saga.chainGenerator<ProfileGen.GeneratePgpPayload>(ProfileGen.generatePgp, generatePgp)
}

export {pgpSaga}
