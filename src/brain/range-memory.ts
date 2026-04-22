import { getSupabase } from '../api/service-factory.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Small set of category hints extracted from the user query used to group
// range answers. "pizza topping" and "pizza ingredient" should both pull
// the same history; "car model" and "car brand" too. We keep this intentionally
// crude — category overlap is enough to avoid cross-contamination with
// unrelated range queries (a car answer shouldn't exclude a pizza answer).
const STOPWORDS = new Set([
  'give','me','a','an','the','just','one','word','name','pick','any','random',
  'please','your','favourite','favorite','what','is','are','for','of','to',
  'and','or','in','on','some','say','tell','list','suggest','it','that','this',
]);

export function extractCategoryKeywords(userMessage: string): string[] {
  const words = userMessage
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
  // Deduplicate, keep first 5
  return Array.from(new Set(words)).slice(0, 5);
}

export class RangeMemoryStore {
  async getRecentAnswers(
    tenantId: string,
    categoryKeywords: string[],
    limit = 10,
  ): Promise<string[]> {
    if (!UUID_RE.test(tenantId) || categoryKeywords.length === 0) return [];
    const supabase = getSupabase();
    try {
      // Pull recent range answers for this tenant; filter by overlap in keywords.
      // We do a wider fetch (50) then client-side filter by array overlap to
      // keep the query simple and avoid needing a fancy RPC.
      const { data, error } = await supabase
        .from('range_answers')
        .select('answer, category_keywords, created_at')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error || !data) return [];

      const kwSet = new Set(categoryKeywords);
      const matching = data.filter((row) => {
        const rowKw = row.category_keywords ?? [];
        return rowKw.some((k: string) => kwSet.has(k));
      });

      const seen = new Set<string>();
      const answers: string[] = [];
      for (const row of matching) {
        const a = String(row.answer).trim();
        const normalized = a.toLowerCase().replace(/[.,!?'"`]/g, '');
        if (!seen.has(normalized)) {
          seen.add(normalized);
          answers.push(a);
          if (answers.length >= limit) break;
        }
      }
      return answers;
    } catch (e) {
      console.error('[RangeMemory] getRecentAnswers error:', e);
      return [];
    }
  }

  async save(tenantId: string, queryText: string, answer: string, categoryKeywords: string[]): Promise<void> {
    if (!UUID_RE.test(tenantId)) return;
    const supabase = getSupabase();
    try {
      const { error } = await supabase.from('range_answers').insert({
        tenant_id: tenantId,
        query_text: queryText.slice(0, 500),
        category_keywords: categoryKeywords,
        answer: answer.slice(0, 500),
      });
      if (error) console.error('[RangeMemory] save error:', error.message);
    } catch (e) {
      console.error('[RangeMemory] save exception:', e);
    }
  }
}

let _store: RangeMemoryStore | null = null;
export function getRangeMemoryStore(): RangeMemoryStore {
  if (!_store) _store = new RangeMemoryStore();
  return _store;
}
