"""
Dictionary service for Tibetan-Chinese dictionary.
Loads Tibetan-Chinese_dictionary.json and provides lookup and inline translation.
"""

import json
import os
import re


class DictionaryService:
    def __init__(self, dict_path=None):
        self.dict_path = dict_path or self._find_dict()
        self.word_map = {}       # tibetan word -> entry
        self.sorted_words = []   # words sorted by length desc for longest-match
        self.total_entries = 0
        self.loaded = False

    def _find_dict(self):
        """Find the dictionary file relative to this script."""
        script_dir = os.path.dirname(os.path.abspath(__file__))
        candidates = [
            # First: inside the backend/data/ directory
            os.path.join(script_dir, 'data', 'Tibetan-Chinese_dictionary.json'),
            os.path.join(script_dir, 'data', 'tibetan_dictionary.json'),
            # Then: project root
            os.path.join(script_dir, '..', '..', 'Tibetan-Chinese_dictionary.json'),
            os.path.join(script_dir, '..', '..', 'tibetan_dictionary.json'),
        ]
        for path in candidates:
            if os.path.exists(path):
                return os.path.abspath(path)
        return None

    def load(self):
        """Load dictionary from JSON file."""
        if not self.dict_path or not os.path.exists(self.dict_path):
            raise FileNotFoundError(f"Dictionary not found at: {self.dict_path}")

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
            }

        # Sort words by length descending for longest-match-first
        self.sorted_words = sorted(self.word_map.keys(), key=lambda w: len(w), reverse=True)
        self.total_entries = len(self.word_map)
        self.loaded = True

    def lookup(self, word):
        """Look up a single word in the dictionary.
        Returns the entry if found, or None.
        """
        if not self.loaded:
            return None
        word = word.strip()
        if not word:
            return None

        # Try exact match first
        entry = self.word_map.get(word)
        if entry:
            return entry

        # Try with trailing །
        entry = self.word_map.get(word + '།')
        if entry:
            return entry

        # Try with trailing ་
        entry = self.word_map.get(word + '་')
        if entry:
            return entry

        return None

    def fuzzy_search(self, query, max_results=20):
        """Search for words containing the query string.
        Returns a list of matching entries.
        """
        if not self.loaded or not query:
            return []

        query = query.strip()
        results = []

        for word, entry in self.word_map.items():
            if query in word:
                results.append({
                    'tibetan': entry['tibetan'],
                    'chinese': entry['chinese'],
                    'pos_cn': entry.get('pos_cn', ''),
                })
                if len(results) >= max_results:
                    break

        return results

    def lookup_batch(self, words):
        """Look up multiple words, return dict of word->entry."""
        results = {}
        for w in words:
            entry = self.lookup(w)
            if entry:
                results[w] = entry
        return results

    def get_stats(self):
        """Get dictionary statistics."""
        return {
            'total_entries': self.total_entries,
            'loaded': self.loaded,
            'path': self.dict_path,
        }

    def get_all_words(self):
        """Get all dictionary words sorted by length descending."""
        return self.sorted_words

    def get_all_entries(self):
        """Get all dictionary entries (for frontend caching)."""
        return list(self.word_map.values())

    def inline_translate(self, text):
        """
        Translate a Tibetan text inline.
        Returns a list of segments: each segment is either a matched word
        (with tibetan and chinese) or untranslated text.
        """
        if not self.loaded or not text:
            return []

        segments = []
        i = 0
        text_len = len(text)

        while i < text_len:
            best_match = None
            for word in self.sorted_words:
                if text.startswith(word, i):
                    best_match = word
                    break

            if best_match:
                entry = self.word_map[best_match]
                segments.append({
                    'type': 'word',
                    'tibetan': best_match,
                    'chinese': entry['chinese'],
                    'pos_cn': entry['pos_cn'],
                })
                i += len(best_match)
            else:
                # Collect untranslated characters
                j = i
                while j < text_len:
                    found = False
                    for word in self.sorted_words:
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
