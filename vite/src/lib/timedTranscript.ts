import type { TimedTranscriptSegment, TimedTranscriptWord } from '@/lib/callTypes'

export interface TimedTranscriptPiece {
  id: string
  text: string
  charStart: number
  charEnd: number
  word: TimedTranscriptWord | null
}

export interface TimedTranscriptModelSegment {
  source: TimedTranscriptSegment
  pieces: TimedTranscriptPiece[]
}

export interface TimedTranscriptModel {
  text: string
  segments: TimedTranscriptModelSegment[]
  timedPieces: TimedTranscriptPiece[]
}

export interface TimedTranscriptMatch {
  id: string
  startChar: number
  endChar: number
  startMs: number
  endMs: number
}

export interface TimedTranscriptSelection {
  atMs: number
  startMs: number
  endMs: number
  quote: string
  startChar: number
  endChar: number
}

function wordText(word: TimedTranscriptWord): string {
  return word.punctuatedWord?.trim() || word.word
}

function findWordStart(text: string, word: TimedTranscriptWord, from: number): number {
  const candidates = [wordText(word), word.word].filter((value, index, values) => value && values.indexOf(value) === index)
  for (const candidate of candidates) {
    const exact = text.indexOf(candidate, from)
    if (exact >= 0) return exact
    const folded = text.toLocaleLowerCase().indexOf(candidate.toLocaleLowerCase(), from)
    if (folded >= 0) return folded
  }
  return -1
}

/** Align provider words back to the provider's canonical segment text. */
export function buildTimedTranscriptModel(segments: readonly TimedTranscriptSegment[]): TimedTranscriptModel {
  let transcriptText = ''
  const timedPieces: TimedTranscriptPiece[] = []
  const modelSegments = segments.map((segment, segmentIndex) => {
    if (segmentIndex > 0) transcriptText += '\n'
    const segmentStart = transcriptText.length
    transcriptText += segment.text
    const pieces: TimedTranscriptPiece[] = []
    let cursor = 0

    for (const [wordIndex, word] of segment.words.entries()) {
      const start = findWordStart(segment.text, word, cursor)
      if (start < 0) continue
      if (start > cursor) {
        pieces.push({
          id: `${segment.id}-gap-${wordIndex}`,
          text: segment.text.slice(cursor, start),
          charStart: segmentStart + cursor,
          charEnd: segmentStart + start,
          word: null,
        })
      }
      const end = start + wordText(word).length
      const piece = {
        id: `${segment.id}-word-${wordIndex}`,
        text: segment.text.slice(start, end),
        charStart: segmentStart + start,
        charEnd: segmentStart + end,
        word,
      }
      pieces.push(piece)
      timedPieces.push(piece)
      cursor = end
    }

    if (cursor < segment.text.length) {
      pieces.push({
        id: `${segment.id}-gap-end`,
        text: segment.text.slice(cursor),
        charStart: segmentStart + cursor,
        charEnd: segmentStart + segment.text.length,
        word: null,
      })
    }
    return { source: segment, pieces }
  })

  return { text: transcriptText, segments: modelSegments, timedPieces }
}

function timedPiecesForRange(model: TimedTranscriptModel, startChar: number, endChar: number): TimedTranscriptPiece[] {
  return model.timedPieces.filter((piece) => piece.charEnd > startChar && piece.charStart < endChar)
}

export function findTimedTranscriptMatches(model: TimedTranscriptModel, rawQuery: string): TimedTranscriptMatch[] {
  const query = rawQuery.trim()
  if (!query) return []
  const haystack = model.text.toLocaleLowerCase()
  const needle = query.toLocaleLowerCase()
  const matches: TimedTranscriptMatch[] = []
  let from = 0
  while (from <= haystack.length - needle.length) {
    const startChar = haystack.indexOf(needle, from)
    if (startChar < 0) break
    const endChar = startChar + needle.length
    const timedPieces = timedPiecesForRange(model, startChar, endChar)
    if (timedPieces.length > 0) {
      matches.push({
        id: `transcript-search-${matches.length}`,
        startChar,
        endChar,
        startMs: timedPieces[0]?.word?.startMs ?? 0,
        endMs: timedPieces.at(-1)?.word?.endMs ?? 0,
      })
    }
    from = endChar
  }
  return matches
}

function pieceElement(node: Node | null): HTMLElement | null {
  const element = node instanceof HTMLElement ? node : node?.parentElement
  return element?.closest<HTMLElement>('[data-transcript-piece]') ?? null
}

function boundaryOffset(piece: HTMLElement, node: Node, offset: number): number {
  const range = document.createRange()
  range.selectNodeContents(piece)
  try {
    range.setEnd(node, offset)
    return range.toString().length
  } catch {
    return 0
  }
}

export function selectionToTimedRange(
  model: TimedTranscriptModel,
  root: HTMLElement,
  selection: Selection | null,
): TimedTranscriptSelection | null {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null
  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null
  const startPiece = pieceElement(range.startContainer)
  const endPiece = pieceElement(range.endContainer)
  if (!startPiece || !endPiece) return null
  const startChar = Number(startPiece.dataset.charStart) + boundaryOffset(startPiece, range.startContainer, range.startOffset)
  const endChar = Number(endPiece.dataset.charStart) + boundaryOffset(endPiece, range.endContainer, range.endOffset)
  if (!Number.isFinite(startChar) || !Number.isFinite(endChar) || endChar <= startChar) return null
  const timedPieces = timedPiecesForRange(model, startChar, endChar)
  const first = timedPieces[0]?.word
  const last = timedPieces.at(-1)?.word
  if (!first || !last) return null
  return {
    atMs: first.startMs,
    startMs: first.startMs,
    endMs: last.endMs,
    quote: model.text.slice(startChar, endChar),
    startChar,
    endChar,
  }
}
