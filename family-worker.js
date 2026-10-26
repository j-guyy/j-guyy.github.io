// ── Family Strava worker (family-strava) ─────────────────────────────────────
//
// The same API as worker.js, for anyone who connects their own Strava account
// (family and friends), deployed as a separate Worker with its own KV and
// Durable Object so the owner's strava-worker is untouched. Configured by
// wrangler.family.toml and deployed by .github/workflows/deploy-family-worker.yml.
//
// How it reuses worker.js without changing it: every person's requests come in
// under /u/<athleteId>/…, and this file strips that prefix and calls worker.js's
// own fetch() with a per-person `env` whose KV bindings prefix every key with
// `u:<athleteId>:` and whose Durable Object namespace names one SyncRunner per
// person. So worker.js's single-user keys ('tokens', 'strava_activities', …)
// become that person's keys, and its sync, hunters and /summary work as is.
//
// Sign-in: /auth/start sends the person to Strava; /auth/callback stores their
// Strava tokens and gives the app a random session token, which the app sends
// as X-Admin-Password on every request. Only a SHA-256 of it is stored. Each
// person can read and change only their own data, and worker.js's admin checks
// (isAdmin compares the header with env.TRAVEL_PASSWORD) pass for them.
//
// Not served here: /mcp and /music (owner-only features of worker.js).
//
// KV layout (one namespace, bound as both STRAVA_DATA and STRAVA_KV):
//   user:<id>         { id, name, tokenHashes: [..], connectedAt }
//   oauth_state:<n>   short-lived OAuth state (10 min TTL)
//   u:<id>:<key>      that person's copy of every worker.js key
//
// Secrets: CLIENT_ID, CLIENT_SECRET (the Strava API app's), optional
// FAMILY_INVITE (when set, /auth/start needs ?invite=<it>). Var: APP_ORIGIN.

import base, { SyncRunner } from './worker.js';

const DEFAULT_APP_ORIGIN = 'https://j-guyy.github.io';
const MAX_SESSIONS = 5;          // devices signed in per person
const STATE_TTL_SECONDS = 600;

function appOrigin(env) { return env.APP_ORIGIN || DEFAULT_APP_ORIGIN; }

function corsHeaders(env) {
    return {
        'Access-Control-Allow-Origin': appOrigin(env),
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Password',
        'Access-Control-Max-Age': '86400',
    };
}

function jsonRes(env, data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...corsHeaders(env), 'Content-Type': 'application/json' },
    });
}

function redirect(url) {
    return new Response(null, { status: 302, headers: { Location: url } });
}

// ── Per-person env ───────────────────────────────────────────────────────────

function prefixKV(kv, prefix) {
    const k = key => prefix + key;
    return {
        get: (key, opts) => kv.get(k(key), opts),
        getWithMetadata: (key, opts) => kv.getWithMetadata(k(key), opts),
        put: (key, value, opts) => kv.put(k(key), value, opts),
        delete: key => kv.delete(k(key)),
        list: async (opts = {}) => {
            const res = await kv.list({ ...opts, prefix: prefix + (opts.prefix || '') });
            return { ...res, keys: res.keys.map(x => ({ ...x, name: x.name.slice(prefix.length) })) };
        },
    };
}

// One SyncRunner per person: worker.js names its runner 'strava-sync'; here the
// name carries the person, and every call tells the runner who it works for.
function scopedSyncRunner(ns, userId) {
    if (!ns) return ns;
    return {
        idFromName: name => ns.idFromName(`u:${userId}:${name}`),
        get: id => {
            const stub = ns.get(id);
            return {
                fetch: (input, init = {}) => {
                    const headers = new Headers(init.headers);
                    headers.set('X-Family-User', String(userId));
                    return stub.fetch(input, { ...init, headers });
                },
            };
        },
    };
}

function scopedEnv(env, userId, password) {
    const prefix = `u:${userId}:`;
    return {
        ...env,
        STRAVA_DATA: prefixKV(env.STRAVA_DATA, prefix),
        STRAVA_KV: prefixKV(env.STRAVA_KV, prefix),
        SYNC_RUNNER: scopedSyncRunner(env.SYNC_RUNNER, userId),
        // worker.js's isAdmin() compares X-Admin-Password with this. The
        // caller has already been checked against their session token here.
        TRAVEL_PASSWORD: password || crypto.randomUUID(),
        MUSIC_DB: undefined,
        MUSIC_SYNC_TOKEN: undefined,
    };
}

// ── Sessions ─────────────────────────────────────────────────────────────────

async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomToken() {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function getUser(env, id) {
    return env.STRAVA_KV.get(`user:${id}`, 'json');
}

async function checkSession(env, user, request) {
    const token = request.headers.get('X-Admin-Password');
    if (!user || !token) return false;
    return (user.tokenHashes || []).includes(await sha256(token));
}

// ── OAuth ────────────────────────────────────────────────────────────────────

async function handleAuthStart(request, env, url) {
    if (env.FAMILY_INVITE && url.searchParams.get('invite') !== env.FAMILY_INVITE) {
        return redirect(`${appOrigin(env)}/family/?error=invite`);
    }
    if (!env.CLIENT_ID || !env.CLIENT_SECRET) return redirect(`${appOrigin(env)}/family/?error=setup`);
    const state = randomToken();
    await env.STRAVA_KV.put(`oauth_state:${state}`, '1', { expirationTtl: STATE_TTL_SECONDS });
    const auth = new URL('https://www.strava.com/oauth/authorize');
    auth.searchParams.set('client_id', env.CLIENT_ID);
    auth.searchParams.set('redirect_uri', `${url.origin}/auth/callback`);
    auth.searchParams.set('response_type', 'code');
    auth.searchParams.set('approval_prompt', 'auto');
    auth.searchParams.set('scope', 'read,activity:read_all');
    auth.searchParams.set('state', state);
    return redirect(auth.toString());
}

async function handleAuthCallback(env, url) {
    const back = reason => redirect(`${appOrigin(env)}/family/?error=${reason}`);
    const state = url.searchParams.get('state') || '';
    if (!state || !(await env.STRAVA_KV.get(`oauth_state:${state}`))) return back('expired');
    await env.STRAVA_KV.delete(`oauth_state:${state}`);
    if (url.searchParams.get('error')) return back('denied');
    const scope = url.searchParams.get('scope') || '';
    if (!scope.split(',').includes('activity:read_all')) return back('scope');

    const res = await fetch('https://www.strava.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            client_id: env.CLIENT_ID,
            client_secret: env.CLIENT_SECRET,
            code: url.searchParams.get('code'),
            grant_type: 'authorization_code',
        }),
    });
    const tokens = await res.json().catch(() => ({}));
    const athlete = tokens.athlete;
    if (!res.ok || !tokens.refresh_token || !athlete?.id) {
        // A full athlete cap (Strava's limit on connected athletes) lands here.
        return back(tokens?.errors?.some?.(e => /limit/i.test(e.code || e.field || '')) ? 'full' : 'strava');
    }

    const id = String(athlete.id);
    const userEnv = scopedEnv(env, id);
    await userEnv.STRAVA_KV.put('tokens', JSON.stringify({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: tokens.expires_at,
    }));

    const session = randomToken();
    const existing = await getUser(env, id);
    const name = [athlete.firstname, athlete.lastname].filter(Boolean).join(' ').trim() || `Athlete ${id}`;
    await env.STRAVA_KV.put(`user:${id}`, JSON.stringify({
        id,
        name,
        tokenHashes: [await sha256(session), ...(existing?.tokenHashes || [])].slice(0, MAX_SESSIONS),
        connectedAt: existing?.connectedAt || new Date().toISOString(),
    }));

    // First connection: start the first sync right away, so the app has
    // activities by the time it opens (or soon after).
    if (!existing && env.SYNC_RUNNER) {
        const stub = userEnv.SYNC_RUNNER.get(userEnv.SYNC_RUNNER.idFromName('strava-sync'));
        await stub.fetch('https://sync-runner/start', { method: 'POST' }).catch(() => {});
    }

    const first = (athlete.firstname || '').trim();
    const app = new URL(`${appOrigin(env)}/app/`);
    app.searchParams.set('family', '1');
    app.searchParams.set('k', `${id}.${session}`);
    if (first) app.searchParams.set('n', first);
    app.hash = 'home';
    return redirect(app.toString());
}

// Disconnect: revoke the app at Strava and delete everything stored for the
// person (Strava's terms require deleting a person's data when they leave).
async function handleDeleteAccount(env, id) {
    const userEnv = scopedEnv(env, id);
    const tokens = await userEnv.STRAVA_KV.get('tokens', 'json');
    if (tokens?.access_token) {
        await fetch('https://www.strava.com/oauth/deauthorize', {
            method: 'POST',
            headers: { Authorization: `Bearer ${tokens.access_token}` },
        }).catch(() => {});
    }
    let cursor;
    do {
        const page = await env.STRAVA_KV.list({ prefix: `u:${id}:`, cursor });
        await Promise.all(page.keys.map(k => env.STRAVA_KV.delete(k.name)));
        cursor = page.list_complete ? null : page.cursor;
    } while (cursor);
    await env.STRAVA_KV.delete(`user:${id}`);
    return jsonRes(env, { ok: true });
}

// ── Entry points ─────────────────────────────────────────────────────────────

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;

        if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(env) });

        try {
            if (path === '/auth/start') return await handleAuthStart(request, env, url);
            if (path === '/auth/callback') return await handleAuthCallback(env, url);

            const m = path.match(/^\/u\/(\d+)(\/.*)$/);
            if (!m) return jsonRes(env, { error: 'Not found' }, 404);
            const [, id, rest] = m;

            const user = await getUser(env, id);
            if (!(await checkSession(env, user, request))) return jsonRes(env, { error: 'Unauthorized' }, 401);

            if (rest === '/account' && request.method === 'GET') {
                return jsonRes(env, { id: user.id, name: user.name, connectedAt: user.connectedAt });
            }
            if (rest === '/account/delete' && request.method === 'POST') return await handleDeleteAccount(env, id);
            if (rest === '/mcp' || rest.startsWith('/music/')) return jsonRes(env, { error: 'Not found' }, 404);

            const inner = new URL(request.url);
            inner.pathname = rest;
            const innerRequest = new Request(inner.toString(), request);
            const password = request.headers.get('X-Admin-Password');
            return await base.fetch(innerRequest, scopedEnv(env, id, password), ctx);
        } catch (err) {
            return jsonRes(env, { error: err.message }, 500);
        }
    },

    // Daily sync for everyone connected, through each person's SyncRunner.
    async scheduled(event, env, ctx) {
        let cursor;
        do {
            const page = await env.STRAVA_KV.list({ prefix: 'user:', cursor });
            for (const k of page.keys) {
                const id = k.name.slice('user:'.length);
                await base.scheduled(event, scopedEnv(env, id), ctx);
            }
            cursor = page.list_complete ? null : page.cursor;
        } while (cursor);
    },
};

// worker.js's SyncRunner, told which person it syncs for. The person arrives
// with each call (X-Family-User, set by scopedSyncRunner) and is kept in the
// object's storage for the alarm that runs the sync.
export class FamilySyncRunner extends SyncRunner {
    constructor(state, env) {
        super(state, env);
        this.rootEnv = env;
        this.userId = null;
    }

    async useUser(id) {
        if (id && id !== this.userId) {
            this.userId = id;
            await this.state.storage.put('familyUser', id);
        } else if (!this.userId) {
            this.userId = (await this.state.storage.get('familyUser')) || null;
        }
        if (this.userId) this.env = scopedEnv(this.rootEnv, this.userId);
    }

    async fetch(request) {
        await this.useUser(request.headers.get('X-Family-User'));
        return super.fetch(request);
    }

    async alarm() {
        await this.useUser(null);
        if (!this.userId) return;
        return super.alarm();
    }
}
