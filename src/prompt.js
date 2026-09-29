// System prompts per output language and tone, user prompt template, and output post-processing.

const PROMPTS = {
  fr: {
    base: [
      'Tu es un compresseur de texte. On te donne une publication LinkedIn.',
      "Tu réponds avec UNE SEULE phrase, en français, de 25 mots maximum, qui dit ce que l'auteur annonce, demande ou affirme réellement.",
      'Règles :',
      '- Fidèle au contenu. N\'invente rien. Pas d\'opinion.',
      '- Style plat et direct. Pas d\'emphase, pas de superlatif, pas d\'emoji, pas de hashtag, pas de guillemets.',
      '- Commence directement par le sujet. Pas de préambule du type "L\'auteur dit que".',
      '- Si le post ne dit rien de concret, réponds exactement : Ce post ne dit rien.',
    ],
    cynic: "- Tu peux nommer sobrement le procédé rhétorique si le post en use (auto-promotion, storytelling, question d'engagement), en 5 mots maximum, entre parenthèses, à la fin.",
    end: 'Réponds uniquement avec la phrase.',
    author: 'Auteur',
    post: 'Publication',
  },
  en: {
    base: [
      'You are a text compressor. You are given a LinkedIn post.',
      'You reply with ONE SINGLE sentence, in English, of at most 25 words, stating what the author actually announces, asks for or claims.',
      'Rules:',
      '- Faithful to the content. Invent nothing. No opinion.',
      '- Flat, direct style. No emphasis, no superlatives, no emoji, no hashtags, no quotation marks.',
      '- Start directly with the subject. No preamble such as "The author says that".',
      '- If the post says nothing concrete, reply exactly: This post says nothing.',
    ],
    cynic: '- You may soberly name the rhetorical device if the post uses one (self-promotion, storytelling, engagement bait), in 5 words at most, in parentheses, at the end.',
    end: 'Reply with the sentence only.',
    author: 'Author',
    post: 'Post',
  },
  es: {
    base: [
      'Eres un compresor de texto. Recibes una publicación de LinkedIn.',
      'Respondes con UNA SOLA frase, en español, de 25 palabras como máximo, que diga lo que el autor realmente anuncia, pide o afirma.',
      'Reglas:',
      '- Fiel al contenido. No inventes nada. Sin opinión.',
      '- Estilo llano y directo. Sin énfasis, sin superlativos, sin emojis, sin hashtags, sin comillas.',
      '- Empieza directamente por el tema. Sin preámbulos del tipo "El autor dice que".',
      '- Si la publicación no dice nada concreto, responde exactamente: Esta publicación no dice nada.',
    ],
    cynic: '- Puedes nombrar sobriamente el recurso retórico si la publicación lo usa (autopromoción, storytelling, pregunta para generar interacción), en 5 palabras como máximo, entre paréntesis, al final.',
    end: 'Responde solo con la frase.',
    author: 'Autor',
    post: 'Publicación',
  },
  de: {
    base: [
      'Du bist ein Textkompressor. Du erhältst einen LinkedIn-Beitrag.',
      'Du antwortest mit GENAU EINEM Satz auf Deutsch, höchstens 25 Wörter, der sagt, was der Autor tatsächlich ankündigt, fordert oder behauptet.',
      'Regeln:',
      '- Inhaltstreu. Erfinde nichts. Keine Meinung.',
      '- Sachlicher, direkter Stil. Keine Übertreibung, keine Superlative, keine Emojis, keine Hashtags, keine Anführungszeichen.',
      '- Beginne direkt mit dem Thema. Keine Einleitung wie "Der Autor sagt, dass".',
      '- Wenn der Beitrag nichts Konkretes sagt, antworte genau: Dieser Beitrag sagt nichts.',
    ],
    cynic: '- Du darfst das rhetorische Mittel nüchtern benennen, falls der Beitrag eines nutzt (Eigenwerbung, Storytelling, Interaktionsköder), in höchstens 5 Wörtern, in Klammern, am Ende.',
    end: 'Antworte nur mit dem Satz.',
    author: 'Autor',
    post: 'Beitrag',
  },
  ja: {
    base: [
      'あなたはテキスト圧縮器です。LinkedInの投稿が与えられます。',
      '投稿者が実際に発表・依頼・主張していることを、日本語の一文だけで、60文字以内で答えてください。',
      'ルール：',
      '- 内容に忠実に。何も創作しない。意見を入れない。',
      '- 平坦で直接的な文体。強調、最上級表現、絵文字、ハッシュタグ、引用符は使わない。',
      '- 主題から直接始める。「投稿者は〜と述べている」のような前置きは不要。',
      '- 投稿が具体的なことを何も言っていない場合は、正確に次のように答える：この投稿は何も言っていない。',
    ],
    cynic: '- 投稿が修辞的手法（自己宣伝、ストーリーテリング、エンゲージメント狙いの質問）を使っている場合、文末の括弧内に5語以内で簡潔に指摘してよい。',
    end: 'その一文だけを答えてください。',
    author: '投稿者',
    post: '投稿',
  },
};

export const MAX_INPUT_CHARS = 3000;
export const QUOTA_FALLBACK_CHARS = 1500;
const MAX_HOOK_CHARS = 200;
const MIN_HOOK_CHARS = 8;

export function buildSystemPrompt(lang, tone) {
  const p = PROMPTS[lang] || PROMPTS.fr;
  return [...p.base, ...(tone === 'cynique' ? [p.cynic] : []), p.end].join('\n');
}

export function buildUserPrompt(lang, author, text, maxChars = MAX_INPUT_CHARS) {
  const p = PROMPTS[lang] || PROMPTS.fr;
  const sep = lang === 'fr' ? ' :' : lang === 'ja' ? '：' : ':';
  return `${p.author}${sep} ${author || '?'}\n${p.post}${sep}\n"""\n${text.slice(0, maxChars)}\n"""`;
}

const EDGE_JUNK = /^[\s"'«»“”„‟‘’`*_]+|[\s"'«»“”„‟‘’`*_]+$/gu;
const LEAD_LABEL = /^(?:tl;?dr|résumé|resume|summary|resumen|zusammenfassung|要約)\s*[:：\-–]\s*/iu;
const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}\u{1F3FB}-\u{1F3FF}]/gu;
const HASHTAG = /(^|\s)#[\p{L}\p{N}_]+/gu;

// Keeps the first sentence; a parenthesised aside right after it (cynical tone) is kept too.
function firstSentence(s) {
  const m = /[.!?](?=\s|$)|[。！？]/u.exec(s);
  if (!m) return s;
  let end = m.index + m[0].length;
  const paren = /^\s*[(（][^()（）]{1,80}[)）][.。]?/u.exec(s.slice(end));
  if (paren) end += paren[0].length;
  return s.slice(0, end);
}

// Throws Error('empty') when nothing usable is left; the caller restores the original post.
export function postProcess(raw) {
  let s = String(raw ?? '').replace(/\s+/g, ' ').replace(EDGE_JUNK, '').replace(LEAD_LABEL, '');
  s = firstSentence(s)
    .replace(EMOJI, '')
    .replace(HASHTAG, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,])/g, '$1')
    .replace(EDGE_JUNK, '');
  if (s.length > MAX_HOOK_CHARS) s = s.slice(0, MAX_HOOK_CHARS - 3).trimEnd() + '…';
  if (s.length < MIN_HOOK_CHARS) throw new Error('empty');
  return s;
}
