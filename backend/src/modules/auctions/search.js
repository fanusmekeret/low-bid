// Turns what a buyer typed into a safe MySQL full-text BOOLEAN MODE query.
// Every word is required (+) and prefix-matched (*), so "sams gal" finds "Samsung Galaxy".
// Operator characters are stripped, so nothing a user types can change the query's meaning.

const MIN_FULLTEXT_TOKEN = 3; // InnoDB default innodb_ft_min_token_size

/** @returns {{ boolean: string|null, fallback: string }} boolean is null when no word is long enough */
export function buildSearch(q) {
  const words = q
    .normalize('NFC')
    .split(/[\s፡-፨]+/) // spaces and Ethiopic punctuation (፡ ። ፣ …)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean)
    .slice(0, 8);
  const long = words.filter((w) => [...w].length >= MIN_FULLTEXT_TOKEN);
  return {
    boolean: long.length ? long.map((w) => `+${w}*`).join(' ') : null,
    fallback: words.join(' ').slice(0, 100),
  };
}
