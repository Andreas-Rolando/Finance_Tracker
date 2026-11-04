// Helper Telegram Bot API (tanpa dependency).

export interface TgUser {
  id: number
  is_bot?: boolean
  first_name: string
  username?: string
}
export interface TgChat {
  id: number
  type: 'private' | 'group' | 'supergroup' | 'channel'
  title?: string
}
export interface TgMessage {
  message_id: number
  from?: TgUser
  chat: TgChat
  text?: string
}
export interface TgCallback {
  id: string
  from: TgUser
  message?: TgMessage
  data?: string
}
export interface TgUpdate {
  update_id: number
  message?: TgMessage
  callback_query?: TgCallback
}

export interface Button {
  text: string
  callback_data?: string
  url?: string
}
export type Keyboard = Button[][]

function token(): string {
  const t = Deno.env.get('TELEGRAM_BOT_TOKEN')
  if (!t) throw new Error('TELEGRAM_BOT_TOKEN belum di-set')
  return t
}

export async function tg<T = unknown>(method: string, body: Record<string, unknown>): Promise<T | null> {
  const res = await fetch(`https://api.telegram.org/bot${token()}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => null)
  if (!json?.ok) {
    console.error(`telegram ${method} gagal`, res.status, json?.description)
    return null
  }
  return json.result as T
}

export function send(chatId: number, text: string, keyboard?: Keyboard, replyTo?: number) {
  return tg<TgMessage>('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    ...(keyboard?.length ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}),
  })
}

export function edit(chatId: number, messageId: number, text: string, keyboard: Keyboard = []) {
  return tg('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    reply_markup: { inline_keyboard: keyboard },
  })
}

export function editKeyboard(chatId: number, messageId: number, keyboard: Keyboard) {
  return tg('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: keyboard } })
}

export function answer(callbackId: string, text?: string, alert = false) {
  return tg('answerCallbackQuery', { callback_query_id: callbackId, text, show_alert: alert })
}
