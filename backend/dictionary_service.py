"""
Dictionary service for Tibetan-Chinese and Tibetan-English dictionaries.
Loads both dictionaries and provides lookup, fuzzy search, and inline translation.
"""

import json
import os
import re


class DictionaryService:
    def __init__(self, dict_path=None, en_dict_path=None):
        # Chinese dictionary
        self.dict_path = dict_path or self._find_dict()
        self.word_map = {}       # tibetan word -> entry (Chinese)
        self.sorted_words = []   # words sorted by length desc for longest-match
        self.total_entries = 0
        self.loaded = False

        # English dictionary
        self.en_dict_path = en_dict_path or self._find_en_dict()
        self.en_word_map = {}    # tibetan word -> entry (English)
        self.en_sorted_words = []
        self.en_total_entries = 0
        self.en_loaded = False

    def _find_dict(self):
        """Find the Chinese dictionary file relative to this script."""
        script_dir = os.path.dirname(os.path.abspath(__file__))
        candidates = [
            os.path.join(script_dir, 'data', 'Tibetan-Chinese_dictionary.json'),
            os.path.join(script_dir, 'data', 'tibetan_dictionary.json'),
            os.path.join(script_dir, '..', '..', 'Tibetan-Chinese_dictionary.json'),
            os.path.join(script_dir, '..', '..', 'tibetan_dictionary.json'),
        ]
        for path in candidates:
            if os.path.exists(path):
                return os.path.abspath(path)
        return None

    def _find_en_dict(self):
        """Find the English dictionary file relative to this script."""
        script_dir = os.path.dirname(os.path.abspath(__file__))
        candidates = [
            os.path.join(script_dir, 'data', 'tibetan-English_dictionary.json'),
            os.path.join(script_dir, '..', '..', 'tibetan-English_dictionary.json'),
        ]
        for path in candidates:
            if os.path.exists(path):
                return os.path.abspath(path)
        return None

    def load(self):
        """Load Chinese dictionary from JSON file."""
        if not self.dict_path or not os.path.exists(self.dict_path):
            raise FileNotFoundError(f"Chinese dictionary not found at: {self.dict_path}")

        with open(self.dict_path, 'r', encoding='utf-8') as f:
            data = json.load(f)

        self.word_map = {}
        for entry in data:
            tibetan = entry.get('tibetan', '').strip()
            if not tibetan:
                continue
            # Normalize: remove trailing །༎ if present for matching
            normalized = tibetan.rstrip('།༎')
            self.word_map[normalized] = {
                'tibetan': tibetan,
                'chinese': entry.get('chinese', ''),
                'pos': entry.get('pos', ''),
                'pos_cn': entry.get('pos_cn', ''),
                'source': 'zh',
            }

        # Sort words by length descending for longest-match-first
        self.sorted_words = sorted(self.word_map.keys(), key=lambda w: len(w), reverse=True)
        self.total_entries = len(self.word_map)
        self.loaded = True

    def load_en_dict(self):
        """Load English dictionary from JSON file."""
        if not self.en_dict_path or not os.path.exists(self.en_dict_path):
            print(f"  ⚠ English dictionary not found at: {self.en_dict_path}")
            self.en_loaded = False
            return

        with open(self.en_dict_path, 'r', encoding='utf-8') as f:
            data = json.load(f)

        self.en_word_map = {}
        for entry in data:
            word = entry.get('word', '').strip()
            if not word:
                continue
            # Normalize: remove trailing །༎ if present for matching
            normalized = word.rstrip('།༎')
            definitions = entry.get('definitions', [])
            pos = entry.get('pos', '')
            self.en_word_map[normalized] = {
                'tibetan': word,
                'english': '; '.join(definitions) if definitions else '',
                'pos': pos,
                'source': 'en',
            }

        # Sort words by length descending for longest-match-first
        self.en_sorted_words = sorted(self.en_word_map.keys(), key=lambda w: len(w), reverse=True)
        self.en_total_entries = len(self.en_word_map)
        self.en_loaded = True
        print(f"  ✓ English dictionary loaded: {self.en_total_entries} entries")

    def lookup(self, word):
        """Look up a single word in both dictionaries.
        Returns the entry if found, or None.
        Merges Chinese and English results if both exist.
        """
        if not self.loaded:
            return None
        word = word.strip()
        if not word:
            return None

        result = None

        # Try Chinese dictionary first
        zh_entry = self._lookup_in_map(word, self.word_map)
        if zh_entry:
            result = dict(zh_entry)

        # Try English dictionary
        en_entry = self._lookup_in_map(word, self.en_word_map)
        if en_entry:
            if result:
                # Merge: add english field to existing result
                result['english'] = en_entry['english']
                result['source'] = 'zh+en'
            else:
                result = dict(en_entry)

        return result

    def _lookup_in_map(self, word, word_map):
        """Look up a word in a specific word map with normalization."""
        # Try exact match first
        entry = word_map.get(word)
        if entry:
            return entry

        # Try with trailing །
        entry = word_map.get(word + '།')
        if entry:
            return entry

        # Try with trailing ་
        entry = word_map.get(word + '་')
        if entry:
            return entry

        return None

    def fuzzy_search(self, query, max_results=50):
        """Search for words containing the query string in both dictionaries.
        Returns a list of matching entries with full information (pos, source, etc.).
        Results are sorted by relevance (prefix match first, then contains).
        """
        if not self.loaded or not query:
            return []

        query = query.strip()
        if not query:
            return []

        results = []
        seen = set()

        # Helper to add result
        def add_result(word_key, entry, source_dict):
            nonlocal results, seen
            if word_key in seen:
                return
            seen.add(word_key)
            
            result = {
                'tibetan': entry['tibetan'],
                'source': source_dict,
            }
            if source_dict == 'zh' or source_dict == 'zh+en':
                result['chinese'] = entry.get('chinese', '')
                result['pos_cn'] = entry.get('pos_cn', '')
                result['pos'] = entry.get('pos', '')
            if source_dict == 'en' or source_dict == 'zh+en':
                result['english'] = entry.get('english', '')
                result['pos'] = entry.get('pos', '')
            results.append(result)

        # Search Chinese dictionary
        for word, entry in self.word_map.items():
            if query in word:
                add_result(word, entry, 'zh')

        # Search English dictionary - merge or add
        for word, entry in self.en_word_map.items():
            if query in word:
                if word in seen:
                    # Merge English into existing Chinese result
                    for r in results:
                        if r.get('tibetan') == entry['tibetan']:
                            r['english'] = entry['english']
                            r['source'] = 'zh+en'
                            if not r.get('pos') and entry.get('pos'):
                                r['pos'] = entry['pos']
                            break
                else:
                    add_result(word, entry, 'en')

        # Sort: prefix matches first, then by length ascending
        def sort_key(r):
            tib = r.get('tibetan', '')
            is_prefix = tib.startswith(query)
            return (0 if is_prefix else 1, len(tib))

        results.sort(key=sort_key)
        return results[:max_results]


    def lookup_batch(self, words):
        """Look up multiple words, return dict of word->entry."""
        results = {}
        for w in words:
            entry = self.lookup(w)
            if entry:
                results[w] = entry
        return results

    def get_stats(self):
        """Get dictionary statistics for both dictionaries."""
        stats = {
            'total_entries': self.total_entries,
            'loaded': self.loaded,
            'path': self.dict_path,
        }
        if self.en_loaded:
            stats['en_total_entries'] = self.en_total_entries
            stats['en_loaded'] = self.en_loaded
            stats['en_path'] = self.en_dict_path
        return stats

    def get_all_words(self):
        """Get all dictionary words sorted by length descending (merged from both dicts)."""
        # Merge and deduplicate
        all_words = set(self.sorted_words)
        all_words.update(self.en_sorted_words)
        return sorted(all_words, key=lambda w: len(w), reverse=True)

    def get_all_entries(self):
        """Get all dictionary entries (for frontend caching)."""
        entries = list(self.word_map.values())
        # Add English entries that aren't already in Chinese
        seen_tibetan = {e['tibetan'] for e in entries}
        for word, entry in self.en_word_map.items():
            if entry['tibetan'] not in seen_tibetan:
                entries.append(entry)
                seen_tibetan.add(entry['tibetan'])
        return entries

    def inline_translate(self, text):
        """
        Translate a Tibetan text inline using both dictionaries.
        Returns a list of segments: each segment is either a matched word
        (with tibetan and translation) or untranslated text.
        """
        if not self.loaded or not text:
            return []

        # Merge sorted words from both dictionaries
        merged_words = self._get_merged_sorted_words()

        segments = []
        i = 0
        text_len = len(text)

        while i < text_len:
            best_match = None
            for word in merged_words:
                if text.startswith(word, i):
                    best_match = word
                    break

            if best_match:
                # Try Chinese first, then English
                entry = self.word_map.get(best_match)
                if entry:
                    segments.append({
                        'type': 'word',
                        'tibetan': best_match,
                        'chinese': entry['chinese'],
                        'pos_cn': entry['pos_cn'],
                        'source': 'zh',
                    })
                else:
                    en_entry = self.en_word_map.get(best_match)
                    if en_entry:
                        segments.append({
                            'type': 'word',
                            'tibetan': best_match,
                            'english': en_entry['english'],
                            'pos': en_entry['pos'],
                            'source': 'en',
                        })
                    else:
                        segments.append({
                            'type': 'text',
                            'text': best_match,
                        })
                i += len(best_match)
            else:
                # Collect untranslated characters
                j = i
                while j < text_len:
                    found = False
                    for word in merged_words:
                        if text.startswith(word, j):
                            found = True
                            break
                    if found:
                        break
                    j += 1
                untranslated = text[i:j]
                if untranslated:
                    segments.append({
                        'type': 'text',
                        'text': untranslated,
                    })
                i = j

        return segments

    def _get_merged_sorted_words(self):
        """Get merged sorted word list from both dictionaries."""
        all_words = set(self.sorted_words)
        all_words.update(self.en_sorted_words)
        return sorted(all_words, key=lambda w: len(w), reverse=True)
