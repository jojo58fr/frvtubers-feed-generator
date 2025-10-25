import { updateFrVtubersTeam, FrVtubersTeamMember } from '../data/vtuberRegistry'

const ensureFetch = (): typeof fetch => {
  const fn = (globalThis as any).fetch as typeof fetch | undefined
  if (!fn) {
    throw new Error(
      'Global fetch API is not available. Please use Node.js >= 18 to enable Twitch sync.',
    )
  }
  return fn
}

const fetchFn = ensureFetch()

type TwitchTokenResponse = {
  access_token: string
  expires_in: number
  token_type: string
}

type TwitchTeamResponse = {
  data?: TwitchTeamEntry[]
}

type TwitchTeamEntry = {
  team_name: string
  team_display_name: string
  users?: TwitchTeamUser[]
}

type TwitchTeamUser = {
  user_id: string
  user_login: string
  user_display_name: string
}

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000 // 1 hour
const RETRY_INTERVAL_MS = 10 * 60 * 1000 // 10 minutes

let scheduled: NodeJS.Timeout | undefined
let isRunning = false
let missingCredentialsLogged = false

export const startFrVtubersTeamSync = () => {
  scheduleRefresh(0)
}

const scheduleRefresh = (delayMs: number) => {
  if (scheduled) {
    clearTimeout(scheduled)
  }
  scheduled = setTimeout(runRefresh, Math.max(delayMs, 0))
}

const runRefresh = async () => {
  if (isRunning) {
    // Avoid overlapping runs; schedule the next standard interval.
    scheduleRefresh(getIntervalMs())
    return
  }
  isRunning = true
  try {
    const members = await fetchTeamMembers()
    if (members) {
      updateFrVtubersTeam(members, new Date().toISOString())
      console.log(
        `[frvtubers-team-sync] Updated Twitch team roster with ${members.length} members.`,
      )
      scheduled = undefined
      scheduleRefresh(getIntervalMs())
    } else {
      scheduleRefresh(RETRY_INTERVAL_MS)
    }
  } catch (err) {
    console.error('[frvtubers-team-sync] Failed to refresh team roster:', err)
    scheduleRefresh(RETRY_INTERVAL_MS)
  } finally {
    isRunning = false
  }
}

const getIntervalMs = (): number => {
  const envInterval = process.env.TWITCH_TEAM_REFRESH_INTERVAL_MS
  if (!envInterval) return DEFAULT_INTERVAL_MS
  const parsed = Number(envInterval)
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed
  }
  return DEFAULT_INTERVAL_MS
}

const fetchTeamMembers = async (): Promise<
  FrVtubersTeamMember[] | undefined
> => {
  const clientId = process.env.TWITCH_CLIENT_ID
  const clientSecret = process.env.TWITCH_CLIENT_SECRET
  const teamName = process.env.TWITCH_TEAM_NAME ?? 'frvtubers'

  if (!clientId || !clientSecret) {
    if (!missingCredentialsLogged) {
      console.warn(
        '[frvtubers-team-sync] Missing TWITCH_CLIENT_ID or TWITCH_CLIENT_SECRET environment variables. Team sync disabled.',
      )
      missingCredentialsLogged = true
    }
    return undefined
  }

  const token = await getAppAccessToken(clientId, clientSecret)
  const team = await getTeamMembers(clientId, token, teamName)
  if (!team) {
    console.warn(
      `[frvtubers-team-sync] Twitch team "${teamName}" not found or returned no data.`,
    )
    return undefined
  }

  const members = (team.users ?? []).map((user) => ({
    userId: user.user_id,
    userLogin: user.user_login,
    displayName: user.user_display_name,
  }))

  return members
}

const getAppAccessToken = async (
  clientId: string,
  clientSecret: string,
): Promise<string> => {
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
  })

  const response = await fetchFn('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    body: params,
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(
      `Failed to retrieve Twitch app token (${response.status}): ${body}`,
    )
  }

  const data = (await response.json()) as TwitchTokenResponse
  return data.access_token
}

const getTeamMembers = async (
  clientId: string,
  token: string,
  teamName: string,
): Promise<TwitchTeamEntry | undefined> => {
  const url = new URL('https://api.twitch.tv/helix/teams')
  url.searchParams.set('name', teamName)

  const response = await fetchFn(url.toString(), {
    headers: {
      'Client-ID': clientId,
      Authorization: `Bearer ${token}`,
    },
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(
      `Failed to fetch Twitch team "${teamName}" (${response.status}): ${body}`,
    )
  }

  const data = (await response.json()) as TwitchTeamResponse
  return data.data?.[0]
}
