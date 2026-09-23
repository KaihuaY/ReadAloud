// Read Aloud - Google Drive uploader + AI ear + AI coach relay
// ---------------------------------------------------------------------------
// A tiny Google Apps Script web app. The Read Aloud app posts each take here,
// and the script saves it into a folder in YOUR Google Drive. It runs as
// you, so the iPad never needs to sign in to Google. It also relays two AI
// requests: a "listen" pass to Gemini (Google) that turns the recording into
// a word-by-word read-out, and a "coach" pass to Claude (Anthropic) that
// turns that read-out into a couple of kind sentences. Both keys live only
// here, in Script Properties, never in the app, the repo, or the synced
// gist.
//
// Setup (once, ~3 minutes):
//   1. Open https://script.google.com and click "New project".
//      Delete the sample code and paste this whole file. Then Project
//      Settings (gear icon) > Script Properties > Add script property:
//      name UPLOAD_SECRET, value any long word of your own (letters/digits,
//      no spaces). The secret lives in a property, NOT in this file, so
//      pasting a newer version of this file later can never reset it.
//   2. For the "ear": Project Settings > Script Properties > Add script
//      property. Name it GEMINI_API_KEY, value a key from Google AI Studio
//      (aistudio.google.com). A paid-tier key is recommended, so the
//      recordings are not used for training. (Optional: READ_DAILY_CAP to
//      change the default 60-takes-a-day limit.) Skip this step and takes
//      are saved to Drive but never scored.
//   3. For the coach and the book-lookup helpers: Project Settings > Script
//      Properties > Add script property. Name it ANTHROPIC_API_KEY, value
//      your Claude API key from console.anthropic.com. (Optional: add
//      COACH_DAILY_CAP and LOOKUP_DAILY_CAP to change their default limits
//      of 80 and 20 a day. If the Test button says the key "is not scoped
//      to a workspace", either create the key inside a workspace in the
//      Console, or add one more property, ANTHROPIC_WORKSPACE_ID, with the
//      workspace id.) Skip this step and the coach quietly uses its
//      built-in phrases instead of Claude, and the photo/title book helpers
//      are unavailable.
//   4. Click Deploy > New deployment > type: Web app.
//        Execute as: Me            Who has access: Anyone
//      Click Deploy, authorize when asked, and copy the Web app URL
//      (it ends in /exec).
//   5. In Read Aloud: Grown-ups (PIN) > Settings > Google Drive + AI:
//      paste the URL and the same SECRET, then press Test.
//   After pasting a NEWER version of this file:
//     a. Run the function "authorizeOnce" once (pick it in the toolbar's
//        function list > Run > Review permissions > Allow). Newer versions
//        may need a permission the old one did not (talking to Gemini or
//        Claude needs "connect to an external service").
//     b. Deploy > Manage deployments > pick your EXISTING deployment >
//        pencil icon > Version: New version > Deploy. The URL stays the
//        same. Do not use "New deployment": that makes a second URL the app
//        does not know about.
//
// SMOKE TESTS (run from a terminal after deploying):
//
//   curl -sL -X POST "<url>" -H "Content-Type: text/plain" \
//        -d '{"secret":"<SECRET>","ping":true}'
//   -> {"ok":true,"pong":true}
//
//   curl -sL -X POST "<url>" -H "Content-Type: text/plain" \
//        -d '{"secret":"<SECRET>","action":"read-status"}'
//   -> {"ok":true,"hasGeminiKey":true,"geminiOk":true, ... }
//
//   curl -sL -X POST "<url>" -H "Content-Type: text/plain" \
//        -d '{"secret":"<SECRET>","action":"read","passageId":"smoke-test",
//             "words":["cat","sat"],"durationSec":3,"mimeType":"audio/m4a",
//             "dataBase64":"<a tiny base64 audio clip>"}'
//   -> {"ok":true,"result":{...},"model":"gemini-3.8-flash","usedToday":1}
// ---------------------------------------------------------------------------

// Legacy fallback only. Prefer the UPLOAD_SECRET script property (see setup step 1): while this
// still says 'change-me-please' and no property is set, every request is refused.
var SECRET = 'change-me-please'

/** The shared secret: the UPLOAD_SECRET script property, else the constant above if it was changed. */
function secret_() {
  var fromProps = PropertiesService.getScriptProperties().getProperty('UPLOAD_SECRET')
  if (fromProps) return fromProps
  return SECRET === 'change-me-please' ? null : SECRET
}

/**
 * Run this once from the editor after pasting a new version. It touches every service the script
 * uses, so Google shows its permission prompt for all of them in one go.
 */
function authorizeOnce() {
  DriveApp.getRootFolder()
  PropertiesService.getScriptProperties().getKeys()
  UrlFetchApp.fetch('https://api.anthropic.com/', { muteHttpExceptions: true })
  UrlFetchApp.fetch('https://generativelanguage.googleapis.com/', { muteHttpExceptions: true })
  Logger.log('Authorized. Now: Deploy > Manage deployments > your existing deployment > New version.')
}

var DEFAULT_FOLDER = 'Read Aloud takes'
// When true, saved files are viewable by anyone who has the link, so the
// Read Aloud app on another device can play them without a Google sign-in.
// Set to false if you prefer to open them only from Drive yourself.
var SHARE_WITH_LINK = true

// Model + default daily caps. A script property of the same name (see setup
// steps 2-3) overrides the default; the model name is not sent by the
// client, so a compromised or buggy client build can't switch models.
var READ_MODEL = 'gemini-3.8-flash'
var READ_DAILY_CAP = 60
var COACH_DAILY_CAP = 80
var LOOKUP_DAILY_CAP = 20

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}')
    var expected = secret_()
    if (!expected) return json({ ok: false, error: 'no secret set: add the UPLOAD_SECRET script property' })
    if (!body || body.secret !== expected) return json({ ok: false, error: 'bad secret' })
    if (body.ping) return json({ ok: true, pong: true })
    if (body.action === 'coach') return doCoach(body)
    if (body.action === 'coach-status') return doCoachStatus()
    if (body.action === 'read') return doRead(body)
    if (body.action === 'read-status') return doReadStatus()
    if (body.action === 'ocr') return doOcr(body)
    if (body.action === 'find-book') return doFindBook(body)
    if (!body.dataBase64) return json({ ok: false, error: 'no audio data' })

    var folder = getOrCreateFolder(body.folderName || DEFAULT_FOLDER)
    var bytes = Utilities.base64Decode(body.dataBase64)
    var blob = Utilities.newBlob(bytes, body.mimeType || 'audio/mp4', body.fileName || 'take.m4a')
    var file = folder.createFile(blob)
    if (body.description) file.setDescription(String(body.description))
    if (SHARE_WITH_LINK) {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW)
    }
    return json({
      ok: true,
      fileId: file.getId(),
      url: file.getUrl(),
      downloadUrl: 'https://drive.google.com/uc?export=download&id=' + file.getId(),
      sizeBytes: file.getSize(),
    })
  } catch (err) {
    return json({ ok: false, error: String(err) })
  }
}

function doGet() {
  return json({ ok: true, service: 'read-aloud' })
}

function getOrCreateFolder(name) {
  var it = DriveApp.getFoldersByName(name)
  return it.hasNext() ? it.next() : DriveApp.createFolder(name)
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON)
}

// --- shared helpers: daily counter, dates, Claude request plumbing --------

/** Local (script time zone) YYYY-MM-DD, used to key the daily request caps. */
function todayKey_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd')
}

/**
 * Claims one of today's `cap` slots under `prefix` (e.g. 'coach-count-'), guarded by a short
 * lock so two requests finishing at nearly the same moment can't both slip past the cap.
 * Returns { ok: true, usedToday } when a slot was claimed, else { ok: false }.
 */
function takeDailySlot_(props, prefix, cap) {
  var countKey = prefix + todayKey_()
  var usedToday
  var lock = LockService.getScriptLock()
  lock.waitLock(10000)
  try {
    var used = Number(props.getProperty(countKey)) || 0
    if (used >= cap) return { ok: false }
    usedToday = used + 1
    props.setProperty(countKey, String(usedToday))
  } finally {
    lock.releaseLock()
  }
  return { ok: true, usedToday: usedToday }
}

/** Request headers for the Claude API; adds the workspace header only when the parent configured one. */
function anthropicHeaders_(props, apiKey) {
  var headers = {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'anthropic-beta': 'server-side-fallback-2026-07-01',
  }
  var workspace = props.getProperty('ANTHROPIC_WORKSPACE_ID')
  if (workspace) headers['anthropic-workspace-id'] = workspace
  return headers
}

/** The API's own error message out of an error response body (Claude or Gemini share this shape). */
function apiErrorMessage_(text) {
  try {
    var parsed = JSON.parse(text)
    return (parsed && parsed.error && parsed.error.message) || text
  } catch (err) {
    return text
  }
}

// --- AI coach: relays one prompt to Claude, key never leaves this script ---

/**
 * { secret, action: 'coach', system, user, schema } -> asks Claude to fill
 * `schema` from `system` + `user`, under a per-day request cap. Model and
 * max_tokens are fixed here (never sent by the client) so a compromised or
 * buggy client build can't run up an unexpected bill.
 */
function doCoach(body) {
  var props = PropertiesService.getScriptProperties()
  var apiKey = props.getProperty('ANTHROPIC_API_KEY')
  if (!apiKey) return json({ ok: false, reason: 'no-key' })

  var cap = Number(props.getProperty('COACH_DAILY_CAP')) || COACH_DAILY_CAP
  var slot = takeDailySlot_(props, 'coach-count-', cap)
  if (!slot.ok) return json({ ok: false, reason: 'cap' })

  var resp = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: anthropicHeaders_(props, apiKey),
    payload: JSON.stringify({
      model: 'claude-opus-5',
      max_tokens: 16000,
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: body.schema } },
      system: body.system,
      messages: [{ role: 'user', content: body.user }],
    }),
  })

  var status = resp.getResponseCode()
  if (status !== 200) {
    return json({ ok: false, reason: 'http-' + status, detail: apiErrorMessage_(resp.getContentText()) })
  }

  var data = JSON.parse(resp.getContentText())
  if (data.stop_reason === 'refusal' || data.stop_reason === 'max_tokens') {
    return json({ ok: false, reason: data.stop_reason })
  }

  var text = ''
  var content = data.content || []
  for (var i = 0; i < content.length; i++) {
    if (content[i] && content[i].type === 'text') text += content[i].text
  }

  var result
  try {
    result = JSON.parse(text)
  } catch (err) {
    return json({ ok: false, reason: 'bad-json', detail: String(err) })
  }

  return json({ ok: true, result: result, model: data.model, usage: data.usage, usedToday: slot.usedToday })
}

/** { secret, action: 'coach-status' } -> for Settings' "Test AI coach" button. */
function doCoachStatus() {
  var props = PropertiesService.getScriptProperties()
  var hasKey = !!props.getProperty('ANTHROPIC_API_KEY')
  var cap = Number(props.getProperty('COACH_DAILY_CAP')) || COACH_DAILY_CAP
  var usedToday = Number(props.getProperty('coach-count-' + todayKey_())) || 0
  if (!hasKey) return json({ ok: true, hasKey: false, usedToday: usedToday, cap: cap })

  // A real, tiny request, so the Test button catches what a key check cannot: a key without
  // credits, a key that is not scoped to a workspace, a model the account cannot use...
  var apiOk = false
  var apiError = ''
  try {
    var resp = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true,
      headers: anthropicHeaders_(props, props.getProperty('ANTHROPIC_API_KEY')),
      payload: JSON.stringify({
        model: 'claude-opus-5',
        max_tokens: 64,
        output_config: { effort: 'low' },
        messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
      }),
    })
    apiOk = resp.getResponseCode() === 200
    if (!apiOk) apiError = 'HTTP ' + resp.getResponseCode() + ': ' + apiErrorMessage_(resp.getContentText())
  } catch (err) {
    apiError = String(err)
  }
  return json({ ok: true, hasKey: true, apiOk: apiOk, apiError: apiError, usedToday: usedToday, cap: cap })
}

// --- The ear: relays one take to Gemini, key never leaves this script -----

// OpenAPI-subset schema Gemini expects for `generationConfig.responseSchema`
// (types are UPPER CASE; this is not JSON Schema).
var READ_SCHEMA = {
  type: 'OBJECT',
  properties: {
    confidence: { type: 'NUMBER' },
    readSeconds: { type: 'NUMBER' },
    transcript: { type: 'STRING' },
    words: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          i: { type: 'INTEGER' },
          w: { type: 'STRING' },
          s: { type: 'STRING', enum: ['read', 'skipped', 'stumbled', 'different'] },
          heard: { type: 'STRING' },
        },
        propertyOrdering: ['i', 'w', 's', 'heard'],
        required: ['i', 'w', 's'],
      },
    },
    extraWords: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  propertyOrdering: ['confidence', 'readSeconds', 'transcript', 'words', 'extraWords'],
  required: ['confidence', 'readSeconds', 'transcript', 'words', 'extraWords'],
}

/** Builds the fixed listening prompt, with the expected words numbered from 0. */
function buildReadPrompt_(words) {
  var numbered = []
  for (var i = 0; i < words.length; i++) {
    numbered.push(i + ': ' + words[i])
  }
  return [
    'A young child is reading a short passage aloud into a microphone. Here are the words she was',
    'asked to read, numbered from 0 in order:',
    '',
    numbered.join('\n'),
    '',
    'Listen to the attached audio and classify every word above into exactly one of these four',
    'statuses, in the same order, one entry per word:',
    '- "read": said clearly and correctly, the first time.',
    '- "stumbled": sounded out letter by letter, repeated, or self-corrected to the right word.',
    '- "different": said a different word and moved on; put what she actually said in `heard`.',
    '- "skipped": never attempted.',
    '',
    'Be conservative. If you are not sure whether a word was read cleanly or stumbled, call it',
    '"stumbled". Never mark a word "read" unless you can actually hear it said correctly. If the',
    'audio is silent, is only noise, or contains no attempt at the passage, you MUST mark every word',
    '"skipped", set `confidence` under 0.1, set `readSeconds` to 0 and leave `transcript` empty -',
    'do not guess what she would have said. Include exactly one entry per word above, in the same',
    'order, using the same `i` index and `w` word text given.',
    '',
    'Also list, in `extraWords`, any words she said that are not in the passage (filler sounds like',
    '"um" do not count).',
    '',
    'Set `readSeconds` to the time from the first read word to the last read word, in seconds (0 if',
    'no word was read). Set `transcript` to exactly what she said, in order, including sounded-out',
    'fragments written the way they were said, for example "c-a-t cat". Set `confidence` to how sure',
    'you are overall, from 0 (not at all) to 1 (completely).',
  ].join('\n')
}

/** Gemini expects specific audio mime types; the browser's MediaRecorder output does not always match. */
function mapReadMimeType_(mimeType) {
  if (mimeType === 'audio/mp4') return 'audio/m4a'
  if (mimeType === 'audio/webm;codecs=opus') return 'audio/webm'
  if (mimeType === 'audio/ogg;codecs=opus') return 'audio/ogg'
  return mimeType
}

/**
 * { secret, action: 'read', passageId, words (or passageWords), durationSec, mimeType,
 *   dataBase64 } -> asks Gemini to score one take against the expected words, under a per-day
 * request cap. Model is fixed here (never sent by the client).
 */
function doRead(body) {
  var props = PropertiesService.getScriptProperties()
  var apiKey = props.getProperty('GEMINI_API_KEY')
  if (!apiKey) return json({ ok: false, reason: 'no-key' })

  var words = body.words || body.passageWords
  if (!words || Object.prototype.toString.call(words) !== '[object Array]' || words.length === 0) {
    return json({ ok: false, reason: 'bad-request' })
  }
  for (var wi = 0; wi < words.length; wi++) {
    if (typeof words[wi] !== 'string') return json({ ok: false, reason: 'bad-request' })
  }
  if (!body.dataBase64 || typeof body.dataBase64 !== 'string') {
    return json({ ok: false, reason: 'bad-request' })
  }

  var cap = Number(props.getProperty('READ_DAILY_CAP')) || READ_DAILY_CAP
  var slot = takeDailySlot_(props, 'read-count-', cap)
  if (!slot.ok) return json({ ok: false, reason: 'cap' })

  var mimeType = mapReadMimeType_(body.mimeType)
  var resp = UrlFetchApp.fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/' + READ_MODEL + ':generateContent',
    {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true,
      headers: { 'x-goog-api-key': apiKey },
      payload: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ inline_data: { mime_type: mimeType, data: body.dataBase64 } }, { text: buildReadPrompt_(words) }],
          },
        ],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
          responseSchema: READ_SCHEMA,
        },
      }),
    }
  )

  var status = resp.getResponseCode()
  if (status !== 200) {
    return json({ ok: false, reason: 'http-' + status, detail: apiErrorMessage_(resp.getContentText()) })
  }

  var data
  try {
    data = JSON.parse(resp.getContentText())
  } catch (err) {
    return json({ ok: false, reason: 'bad-json', detail: String(err) })
  }

  if (data.promptFeedback && data.promptFeedback.blockReason) {
    return json({ ok: false, reason: 'blocked', detail: data.promptFeedback.blockReason })
  }

  var candidate = data.candidates && data.candidates[0]
  if (!candidate) {
    return json({ ok: false, reason: 'blocked', detail: 'no candidates returned' })
  }
  if (candidate.finishReason && candidate.finishReason !== 'STOP') {
    return json({ ok: false, reason: 'blocked', detail: candidate.finishReason })
  }

  var text = ''
  var parts = (candidate.content && candidate.content.parts) || []
  for (var i = 0; i < parts.length; i++) {
    if (parts[i] && typeof parts[i].text === 'string') text += parts[i].text
  }

  var result
  try {
    result = JSON.parse(text)
  } catch (err2) {
    return json({ ok: false, reason: 'bad-json', detail: String(err2) })
  }

  return json({ ok: true, result: result, model: READ_MODEL, usage: data.usageMetadata, usedToday: slot.usedToday })
}

/** { secret, action: 'read-status' } -> for Settings' "Test ear + coach" button. */
function doReadStatus() {
  var props = PropertiesService.getScriptProperties()
  var hasGeminiKey = !!props.getProperty('GEMINI_API_KEY')
  var hasClaudeKey = !!props.getProperty('ANTHROPIC_API_KEY')

  var readCap = Number(props.getProperty('READ_DAILY_CAP')) || READ_DAILY_CAP
  var coachCap = Number(props.getProperty('COACH_DAILY_CAP')) || COACH_DAILY_CAP
  var lookupCap = Number(props.getProperty('LOOKUP_DAILY_CAP')) || LOOKUP_DAILY_CAP

  var readUsedToday = Number(props.getProperty('read-count-' + todayKey_())) || 0
  var coachUsedToday = Number(props.getProperty('coach-count-' + todayKey_())) || 0
  var lookupUsedToday = Number(props.getProperty('lookup-count-' + todayKey_())) || 0

  // Real, tiny requests to both services, so the Test button catches what a key check cannot.
  // Neither counts against the daily caps above.
  var geminiOk = false
  var geminiError = ''
  if (hasGeminiKey) {
    try {
      var geminiResp = UrlFetchApp.fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/' + READ_MODEL + ':generateContent',
        {
          method: 'post',
          contentType: 'application/json',
          muteHttpExceptions: true,
          headers: { 'x-goog-api-key': props.getProperty('GEMINI_API_KEY') },
          payload: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: 'Reply with the single word OK.' }] }],
          }),
        }
      )
      geminiOk = geminiResp.getResponseCode() === 200
      if (!geminiOk) {
        geminiError = 'HTTP ' + geminiResp.getResponseCode() + ': ' + apiErrorMessage_(geminiResp.getContentText())
      }
    } catch (err) {
      geminiError = String(err)
    }
  }

  var claudeOk = false
  var claudeError = ''
  if (hasClaudeKey) {
    try {
      var claudeResp = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
        method: 'post',
        contentType: 'application/json',
        muteHttpExceptions: true,
        headers: anthropicHeaders_(props, props.getProperty('ANTHROPIC_API_KEY')),
        payload: JSON.stringify({
          model: 'claude-opus-5',
          max_tokens: 64,
          output_config: { effort: 'low' },
          messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
        }),
      })
      claudeOk = claudeResp.getResponseCode() === 200
      if (!claudeOk) {
        claudeError = 'HTTP ' + claudeResp.getResponseCode() + ': ' + apiErrorMessage_(claudeResp.getContentText())
      }
    } catch (err2) {
      claudeError = String(err2)
    }
  }

  return json({
    ok: true,
    hasGeminiKey: hasGeminiKey,
    geminiModel: READ_MODEL,
    geminiOk: geminiOk,
    geminiError: geminiError,
    hasClaudeKey: hasClaudeKey,
    claudeOk: claudeOk,
    claudeError: claudeError,
    readUsedToday: readUsedToday,
    readCap: readCap,
    coachUsedToday: coachUsedToday,
    coachCap: coachCap,
    lookupUsedToday: lookupUsedToday,
    lookupCap: lookupCap,
  })
}

// --- Photo of a book page: Claude vision, relayed the same way as coach ---

// Anthropic structured outputs: plain JSON Schema, but no min/max keywords (Anthropic rejects them).
var OCR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    text: { type: 'string' },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'text', 'warnings'],
}

var OCR_PROMPT =
  "Transcribe the printed story text on this children's-book page exactly, in reading order. " +
  'Drop page numbers, running headers, and picture captions, but keep sentence punctuation. Put a ' +
  'short title guess in `title`. List anything uncertain (blurry words, cut-off lines) in `warnings`.'

/**
 * { secret, action: 'ocr', imageBase64, mediaType } -> asks Claude vision to transcribe a photo
 * of a book page, under a per-day request cap shared with `find-book`.
 */
function doOcr(body) {
  var props = PropertiesService.getScriptProperties()
  var apiKey = props.getProperty('ANTHROPIC_API_KEY')
  if (!apiKey) return json({ ok: false, reason: 'no-key' })

  if (!body.imageBase64 || typeof body.imageBase64 !== 'string') {
    return json({ ok: false, reason: 'bad-request' })
  }
  if (body.mediaType !== 'image/jpeg' && body.mediaType !== 'image/png') {
    return json({ ok: false, reason: 'bad-request' })
  }

  var cap = Number(props.getProperty('LOOKUP_DAILY_CAP')) || LOOKUP_DAILY_CAP
  var slot = takeDailySlot_(props, 'lookup-count-', cap)
  if (!slot.ok) return json({ ok: false, reason: 'cap' })

  var resp = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: anthropicHeaders_(props, apiKey),
    payload: JSON.stringify({
      model: 'claude-opus-5',
      max_tokens: 4000,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: OCR_SCHEMA } },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: body.mediaType, data: body.imageBase64 } },
            { type: 'text', text: OCR_PROMPT },
          ],
        },
      ],
    }),
  })

  var status = resp.getResponseCode()
  if (status !== 200) {
    return json({ ok: false, reason: 'http-' + status, detail: apiErrorMessage_(resp.getContentText()) })
  }

  var data = JSON.parse(resp.getContentText())
  if (data.stop_reason === 'refusal' || data.stop_reason === 'max_tokens') {
    return json({ ok: false, reason: data.stop_reason })
  }

  var text = ''
  var content = data.content || []
  for (var i = 0; i < content.length; i++) {
    if (content[i] && content[i].type === 'text') text += content[i].text
  }

  var result
  try {
    result = JSON.parse(text)
  } catch (err) {
    return json({ ok: false, reason: 'bad-json', detail: String(err) })
  }

  return json({ ok: true, result: result, usedToday: slot.usedToday })
}

// --- Find a book by title: Claude + web search, then a plain conversion pass ---

var FIND_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', enum: ['excerpt', 'original', 'none'] },
    title: { type: 'string' },
    text: { type: 'string' },
    note: { type: 'string' },
  },
  required: ['kind', 'title', 'text', 'note'],
}

function buildFindBookPrompt_(title, level, levelHint) {
  return [
    'A young child (reading level ' + level + ' out of 8; allowed phonics/vocabulary: ' + levelHint + ')',
    'wants to read a passage from the book "' + title + '".',
    '',
    'Find out whether this book, or an excerpt of it, is public domain or otherwise freely and',
    'legally readable online. If you find a public-domain excerpt of at most 80 words that fits the',
    'reading level above, use it verbatim as the passage (kind "excerpt"). Otherwise, write an',
    'ORIGINAL passage (3-4 short sentences, using only the vocabulary the level allows) about the',
    "story, clearly not the book's own words (kind \"original\"). If you cannot identify the book at",
    'all, say so (kind "none", empty text).',
    '',
    'Whatever you find, end your reply with a single fenced code block, labelled json, containing',
    'exactly this shape and nothing else inside the fences:',
    '```json',
    '{"kind": "excerpt" | "original" | "none", "title": "<the book title as you found it>",',
    ' "text": "<the passage, or an empty string for kind none>",',
    ' "note": "<one short sentence about where the text is from>"}',
    '```',
  ].join('\n')
}

/** Pulls the LAST fenced ```json ... ``` block out of Claude's answer and parses it. */
function extractFindBookJson_(text) {
  var matches = text.match(/```json([\s\S]*?)```/g)
  if (!matches || matches.length === 0) return null
  var last = matches[matches.length - 1]
  var inner = last.replace(/```json/, '').replace(/```\s*$/, '')
  try {
    var parsed = JSON.parse(inner)
    if (parsed && typeof parsed.kind === 'string') return parsed
    return null
  } catch (err) {
    return null
  }
}

/** Call 2: a no-tool, schema-constrained pass that converts call 1's free-text answer to JSON. */
function convertFindBookAnswer_(props, apiKey, previousText, title) {
  var resp = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: anthropicHeaders_(props, apiKey),
    payload: JSON.stringify({
      model: 'claude-opus-5',
      max_tokens: 2000,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: FIND_SCHEMA } },
      messages: [
        {
          role: 'user',
          content:
            'Convert the answer below, about the book "' +
            title +
            '", into the required JSON shape. Do not add new information: extract kind, title, ' +
            'text, and note from what is written.\n\n' +
            previousText,
        },
      ],
    }),
  })

  if (resp.getResponseCode() !== 200) return null

  var data
  try {
    data = JSON.parse(resp.getContentText())
  } catch (err) {
    return null
  }
  if (data.stop_reason === 'refusal' || data.stop_reason === 'max_tokens') return null

  var text = ''
  var content = data.content || []
  for (var i = 0; i < content.length; i++) {
    if (content[i] && content[i].type === 'text') text += content[i].text
  }

  try {
    return JSON.parse(text)
  } catch (err2) {
    return null
  }
}

/** Truncates `text` to at most 80 words, cutting at the last sentence end within that limit. */
function truncateExcerptTo80Words_(text) {
  var words = text.split(/\s+/)
  var truncated = words.slice(0, 80).join(' ')
  var lastEnd = Math.max(truncated.lastIndexOf('.'), truncated.lastIndexOf('!'), truncated.lastIndexOf('?'))
  if (lastEnd > 0) return truncated.substring(0, lastEnd + 1)
  return truncated
}

/** Server-side invariants that must hold regardless of what the model produced. */
function applyFindBookInvariants_(result) {
  if (result.kind === 'original') {
    result.note = "Made up from the story - not the book's words"
  } else if (result.kind === 'excerpt' && typeof result.text === 'string') {
    var wordCount = result.text.split(/\s+/).filter(function (w) {
      return w.length > 0
    }).length
    if (wordCount > 80) result.text = truncateExcerptTo80Words_(result.text)
  }
  return result
}

/**
 * { secret, action: 'find-book', title, level, levelHint } -> two-step lookup: call 1 asks
 * Claude + web search whether the book is public domain, ending in a fenced json block; if that
 * block cannot be parsed, call 2 asks a plain (tool-free) Claude pass to convert call 1's answer
 * with a schema. Shares its per-day request cap with `ocr`.
 */
function doFindBook(body) {
  var props = PropertiesService.getScriptProperties()
  var apiKey = props.getProperty('ANTHROPIC_API_KEY')
  if (!apiKey) return json({ ok: false, reason: 'no-key' })

  if (!body.title || typeof body.title !== 'string') {
    return json({ ok: false, reason: 'bad-request' })
  }

  var cap = Number(props.getProperty('LOOKUP_DAILY_CAP')) || LOOKUP_DAILY_CAP
  var slot = takeDailySlot_(props, 'lookup-count-', cap)
  if (!slot.ok) return json({ ok: false, reason: 'cap' })

  var level = body.level || 3
  var levelHint = body.levelHint || ''

  // Call 1: web search allowed, no structured output (citations and structured output can't mix).
  var resp = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: anthropicHeaders_(props, apiKey),
    payload: JSON.stringify({
      model: 'claude-opus-5',
      max_tokens: 4000,
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 4 }],
      messages: [{ role: 'user', content: buildFindBookPrompt_(body.title, level, levelHint) }],
    }),
  })

  var status = resp.getResponseCode()
  if (status !== 200) {
    return json({ ok: false, reason: 'http-' + status, detail: apiErrorMessage_(resp.getContentText()) })
  }

  var data
  try {
    data = JSON.parse(resp.getContentText())
  } catch (err) {
    return json({ ok: false, reason: 'bad-json', detail: String(err) })
  }
  if (data.stop_reason === 'refusal') {
    return json({ ok: false, reason: 'refusal' })
  }

  var text = ''
  var content = data.content || []
  for (var i = 0; i < content.length; i++) {
    if (content[i] && content[i].type === 'text' && typeof content[i].text === 'string') text += content[i].text
  }

  var result = extractFindBookJson_(text)
  if (!result) {
    result = convertFindBookAnswer_(props, apiKey, text, body.title)
    if (!result) return json({ ok: false, reason: 'bad-json' })
  }

  result = applyFindBookInvariants_(result)

  return json({ ok: true, result: result, usedToday: slot.usedToday })
}
