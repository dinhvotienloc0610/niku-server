// index.js — Versatile-only restaurant assistant API

import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import dotenv from 'dotenv'
import express from 'express'
import cors from 'cors'
import OpenAI from 'openai'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Load .env that sits next to index.js
dotenv.config({ path: path.join(__dirname, '.env') })

// --- Express setup ---
const app = express()
app.use(cors())                 // permissive for now; lock down later with an allowlist
app.use(express.json())

// --- Load your restaurant facts ---
const kbPath = path.join(__dirname, 'restaurant.json')
const KB = JSON.parse(fs.readFileSync(kbPath, 'utf8'))

function kbToText(kb) {
    const lines = []
    lines.push(`Restaurant: ${kb.name}`)
    if (kb.contact?.email) lines.push(`Contact email: ${kb.contact.email}`)
    if (kb.contact?.phone) lines.push(`Contact phone: ${kb.contact.phone}`)
    if (kb.policies?.buffet_time_limit_minutes) {
        lines.push(`Buffet time limit: ${kb.policies.buffet_time_limit_minutes} minutes`)
    }
    if (kb.policies?.large_party_deposit_required) {
        lines.push(`Large party deposit required: yes`)
    }
    if (kb.policies?.allergy_note) {
        lines.push(`Allergy note: ${kb.policies.allergy_note}`)
    }
    for (const loc of kb.locations || []) {
        lines.push(`Location: ${loc.city}`)
        for (const a of loc.address || []) lines.push(`  ${a}`)
        for (const [d, h] of Object.entries(loc.hours || {})) lines.push(`  ${d}: ${h}`)
    }
    if (kb.menu_highlights?.length) {
        lines.push(`Menu highlights: ${kb.menu_highlights.join(', ')}`)
    }
    return lines.join('\n')
}
const KB_TEXT = kbToText(KB)

// --- OpenAI client ---
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// --- Health check ---
app.get('/health', (req, res) => res.json({ ok: true }))

// --- Chat endpoint (versatile-only rules) ---
app.post('/api/chat', async (req, res) => {
    try {
        const { messages = [] } = req.body || {}

        const RULES_VERSATILE = [
            // Core behavior
            "You are a concise, friendly restaurant assistant.",
            "FIRST: If the user asks about this restaurant (hours, locations, policies, contact, menu highlights), answer from the REFERENCE DATA exactly.",
            "SECOND: If the user asks a general food/culinary question (e.g., 'what is A5 Wagyu?', 'what is nigiri?'), answer briefly using general knowledge.",
            "If the reference data conflicts with general knowledge, the REFERENCE DATA takes priority for anything about this restaurant.",
            "If information is missing or ambiguous, say you don't have that and ask a short follow-up.",
            // Reservations & safety
            "If asked to book, collect: name, email, phone number, party size, date, time, special requests, allergy.",
            "Do NOT invent prices, promotions, or unavailable items. If unsure, ask to confirm.",
            "",
            "REFERENCE DATA:",
            KB_TEXT
        ].join('\n')

        const completion = await client.chat.completions.create({
            model: 'gpt-4o',
            temperature: 0.2,
            messages: [
                { role: 'system', content: RULES_VERSATILE },
                ...messages
            ],
            max_tokens: 400
        })

        res.json({ reply: completion.choices[0].message.content })
    } catch (err) {
        console.error(err)
        res.status(500).json({ error: 'Chat backend error' })
    }
})

// --- Start server (Render injects PORT) ---
const PORT = process.env.PORT || 8787
app.listen(PORT, () => console.log(`API ready on http://localhost:${PORT}`))
