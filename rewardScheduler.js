import https from 'https'
import { config } from './config.js'

const { TARGET_URL, REQUEST_BODY, TARGET_TIMES, TOKENS, ORIGIN } = config
const REQUEST_BODY_STRING = JSON.stringify(REQUEST_BODY)

// --- Server clock calibration helpers ---
async function calibrateServerOffset() {
  const url = new URL(TARGET_URL)

  async function measureOnce(method) {
    return new Promise(resolve => {
      const t0 = Date.now()
      const req = https.request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || 443,
          path: '/',
          method,
          timeout: 5000,
        },
        res => {
          const t1 = Date.now()
          const serverDateHeader = res.headers && res.headers.date
          if (!serverDateHeader) {
            resolve(undefined)
            return
          }
          const serverDate = new Date(serverDateHeader)
          if (Number.isNaN(serverDate.getTime())) {
            resolve(undefined)
            return
          }
          const rttMs = t1 - t0
          const midLocal = t0 + rttMs / 2
          const offsetMs = serverDate.getTime() - midLocal
          resolve({ serverDate, offsetMs, rttMs })
        },
      )
      req.on('error', () => resolve(undefined))
      req.end()
    })
  }

  const attempts = []
  for (let i = 0; i < 3; i++) {
    const head = await measureOnce('HEAD')
    if (head) attempts.push(head)
    const get = await measureOnce('GET')
    if (get) attempts.push(get)
  }
  if (!attempts.length) return undefined
  attempts.sort((a, b) => a.rttMs - b.rttMs)
  return attempts[0]
}

function getTzOffsetMinutesFromEnv() {
  const raw = process.env.SERVER_TZ_MINUTES
  if (!raw) return 0
  const n = parseInt(raw, 10)
  return Number.isFinite(n) ? n : 0
}

// Computes next occurrence of HH:MM:SS on the SERVER clock, returning the local fire Date
function computeNextLocalFireTimeAlignedToServer(
  timeStr,
  serverNow,
  tzOffsetMinutes,
  serverOffsetMs,
) {
  const [hh, mm, ss] = timeStr.split(':').map(v => parseInt(v, 10))
  if ([hh, mm, ss].some(n => Number.isNaN(n))) {
    throw new Error(`Invalid time format: ${timeStr}`)
  }

  const serverLocalNowMs = serverNow.getTime() + tzOffsetMinutes * 60_000
  const serverLocalNow = new Date(serverLocalNowMs)

  const targetLocal = new Date(serverLocalNow)
  targetLocal.setHours(hh, mm, ss, 0)
  if (targetLocal.getTime() <= serverLocalNowMs) {
    targetLocal.setDate(targetLocal.getDate() + 1)
  }

  const targetUtcMs = targetLocal.getTime() - tzOffsetMinutes * 60_000
  const localFireMs = targetUtcMs - serverOffsetMs
  return new Date(localFireMs)
}

function computeNextOccurrenceTodayOrTomorrow(timeStr) {
  const [hh, mm, ss] = timeStr.split(':').map(v => parseInt(v, 10))
  if ([hh, mm, ss].some(n => Number.isNaN(n))) {
    throw new Error(`Invalid time format: ${timeStr}`)
  }
  const now = new Date()
  const scheduled = new Date(now)
  scheduled.setHours(hh, mm, ss, 0)
  if (scheduled <= now) {
    // schedule for tomorrow
    scheduled.setDate(scheduled.getDate() + 1)
  }
  return scheduled
}

function scheduleAt(dateObj, callback) {
  const delayMs = dateObj.getTime() - Date.now()
  if (delayMs <= 0) {
    // If somehow negative, run on next tick
    return setTimeout(callback, 0)
  }
  return setTimeout(callback, delayMs)
}

function sendRewardRequest(token) {
  return new Promise(resolve => {
    const url = new URL(TARGET_URL)
    const headers = {
      accept: 'application/json',
      'accept-language': 'en-US,en;q=0.9',
      authorization: token,
      'cache-control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'content-type': 'application/json',
      dnt: '1',
      origin: ORIGIN,
      pragma: 'no-cache',
      priority: 'u=1, i',
      referer: ORIGIN,
      'sec-ch-ua':
        '"Google Chrome";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"macOS"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-site',
      'sec-gpc': '1',
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X x.y; rv:42.0) Gecko/20100101 Firefox/42.0',
      'content-length': Buffer.byteLength(REQUEST_BODY_STRING),
    }

    const options = {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + (url.search || ''),
      method: 'POST',
      headers,
      timeout: 10_000,
    }

    const req = https.request(options, res => {
      const chunks = []
      res.on('data', d => chunks.push(d))
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8')
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          body,
        })
      })
    })

    req.on('error', err => {
      resolve({
        ok: false,
        status: 0,
        body: String(err && err.message ? err.message : err),
      })
    })

    req.write(REQUEST_BODY_STRING)
    req.end()
  })
}

async function main() {
  // 1) Calibrate against server time with RTT-compensated offset
  const calibration = await calibrateServerOffset()
  const tzOffsetMinutes = getTzOffsetMinutesFromEnv()

  let schedules = []
  if (calibration) {
    const { offsetMs } = calibration
    const serverNow = new Date(Date.now() + offsetMs)
    console.log(
      `Calibrated server time. serverNow=${serverNow.toISOString()} offsetMs=${offsetMs}`,
    )

    for (const timeStr of TARGET_TIMES) {
      const when = computeNextLocalFireTimeAlignedToServer(
        timeStr,
        serverNow,
        tzOffsetMinutes,
        offsetMs,
      )
      schedules.push({ timeStr, when })
    }
  } else {
    console.warn(
      'Could not fetch server time. Falling back to local clock scheduling.',
    )
    for (const timeStr of TARGET_TIMES) {
      const when = computeNextOccurrenceTodayOrTomorrow(timeStr)
      schedules.push({ timeStr, when })
    }
  }

  schedules.sort((a, b) => a.when - b.when)

  const totalDispatches = TOKENS.length * schedules.length
  let completed = 0

  console.log('Scheduling reward requests for the following local times:')
  for (const s of schedules) {
    console.log(`  - ${s.timeStr} -> ${s.when.toString()}`)
  }

  for (const s of schedules) {
    scheduleAt(s.when, async () => {
      const ts = new Date()
      for (let i = 0; i < TOKENS.length; i++) {
        const token = TOKENS[i]
        const label = `time=${s.timeStr} actual=${ts.toTimeString().split(' ')[0]} user#${i + 1}`
        try {
          const result = await sendRewardRequest(token)
          if (result.ok) {
            console.log(`[OK] ${label} status=${result.status}`)
            console.log(result.body)
          } else {
            console.warn(
              `[FAIL] ${label} status=${result.status} body=${result.body}`,
            )
          }
        } catch (err) {
          console.error(
            `[ERROR] ${label} ${err && err.message ? err.message : err}`,
          )
        } finally {
          completed += 1
          if (completed >= totalDispatches) {
            // Allow logs to flush
            setTimeout(() => process.exit(0), 250)
          }
        }
      }
    })
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
