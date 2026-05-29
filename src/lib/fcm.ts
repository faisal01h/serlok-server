import admin from 'firebase-admin'
import { readFileSync } from 'fs'

let initialized = false

function getCredential(): admin.credential.Credential | null {
  // Option 1: inline JSON string (good for containers / CI)
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT
  if (serviceAccountJson) {
    return admin.credential.cert(JSON.parse(serviceAccountJson) as admin.ServiceAccount)
  }

  // Option 2: path to service-account JSON file (good for local dev)
  const serviceAccountPath = process.env.FCM_SERVICE_ACCOUNT_PATH
  if (serviceAccountPath) {
    try {
      const json = JSON.parse(readFileSync(serviceAccountPath, 'utf-8')) as admin.ServiceAccount
      return admin.credential.cert(json)
    } catch {
      console.error('[FCM] Failed to read service account file at', serviceAccountPath)
    }
  }

  return null
}

function getApp(): admin.app.App | null {
  if (!initialized) {
    const credential = getCredential()
    if (!credential) return null
    admin.initializeApp({ credential })
    initialized = true
  }
  return admin.app()
}

/**
 * Send a reaction push notification via FCM.
 * Returns silently if FCM is not configured.
 */
export async function sendReactionPush(
  fcmToken: string,
  senderName: string,
  emoji: string,
): Promise<void> {
  const app = getApp()
  if (!app) return // FCM not configured — skip silently

  await app.messaging().send({
    token: fcmToken,
    notification: {
      title: `${senderName} sent you a reaction`,
      body: emoji,
    },
    apns: {
      payload: {
        aps: {
          sound: 'default',
          badge: 1,
        },
      },
    },
    data: {
      type: 'reaction:received',
      emoji,
      senderName,
    },
  })
}
