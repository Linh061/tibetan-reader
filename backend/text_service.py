"""
Text service for managing and searching Tibetan text files.
Supports pagination for efficient rendering of large texts.
Now reads from tibetan-reader/data/texts/ organized by PDF groups.
"""

import os
import re
import glob
import math
import json


class TextService:
    def __init__(self, data_dir=None):
        self.data_dir = data_dir or self._find_data_dir()
        self.loaded_text = {}       # file_id -> text content
        self.current_file = None

    def _find_data_dir(self):
        """Find the data/texts directory."""
        script_dir = os.path.dirname(os.path.abspath(__file__))
        candidates = [
            os.path.join(script_dir, '..', 'data', 'texts'),
            os.path.join(script_dir, 'data', 'texts'),
        ]
        for path in candidates:
            if os.path.isdir(path):
                return os.path.abspath(path)
        return None

    def _get_collections(self):
        """Get all text collections (PDF groups) from data/texts/."""
        if not self.data_dir or not os.path.isdir(self.data_dir):
            return []
        
        collections = []
        for item in sorted(os.listdir(self.data_dir)):
            item_path = os.path.join(self.data_dir, item)
            if os.path.isdir(item_path):
                txt_files = sorted(glob.glob(os.path.join(item_path, '*.txt')))
                if txt_files:
                    collections.append({
                        'id': item,
                        'name': item,
                        'path': item_path,
                        'type': 'collection',
                        'page_count': len(txt_files),
                    })
            elif item.endswith('.txt') and item != 'combined.txt':
                collections.append({
                    'id': item.replace('.txt', ''),
                    'name': item,
                    'path': item_path,
                    'type': 'single',
                    'page_count': 1,
                })
        
        return collections

    def list_texts(self):
        """List all available text files (legacy format)."""
        texts = []
        
        # Combined text file
        combined_path = os.path.join(self.data_dir, 'combined.txt') if self.data_dir else None
        if combined_path and os.path.exists(combined_path):
            texts.append({
                'id': '__combined__',
                'name': 'combined.txt',
                'path': combined_path,
                'type': 'combined',
                'size': os.path.getsize(combined_path),
            })

        # Collections
        for coll in self._get_collections():
            if coll['type'] == 'collection':
                texts.append({
                    'id': f'__collection__{coll["id"]}',
                    'name': f'{coll["id"]}/ ({coll["page_count"]} pages)',
                    'path': coll['path'],
                    'type': 'collection',
                    'size': 0,
                    'collection_id': coll['id'],
                    'page_count': coll['page_count'],
                })

        return texts

    def list_collections(self):
        """List text collections with metadata for the collection selector."""
        collections = []
        
        # The main collection: 德格版《四部医典》
        coll_pages = []
        for coll in self._get_collections():
            if coll['type'] == 'collection' and coll['id'] != 'Preface':
                coll_pages.append(coll)
        
        collections.append({
            'id': 'sibu_yidian',
            'title_cn': '德格版《四部医典》',
            'title_bo': 'དེ་དགེ་པར་མའི་གསོ་བ་རིག་པའི་བསྟན་བཅོས།',
            'description': '藏医药经典文献集成 · 德格版《四部医典》全文OCR',
            'pdf_groups': sorted([c['id'] for c in coll_pages]),
            'total_pages': sum(c['page_count'] for c in coll_pages),
            'has_preface': any(c['id'] == 'Preface' for c in self._get_collections()),
        })
        
        return collections

    def _get_page_number(self, filepath):
        """Extract page number from filename using regex.
        Supports formats: page_001.txt, page 1.txt, 061-090 - page 1.txt, etc.
        Returns the page number as int, or 0 if not found.
        """
        filename = os.path.basename(filepath)
        match = re.search(r'page[_\s]*(\d+)', filename, re.IGNORECASE)
        if match:
            return int(match.group(1))
        return 0

    def _get_all_page_files(self, coll):
        """Get all page files in order (Preface first, then PDF groups).
        Files within each group are sorted numerically by page number,
        not alphabetically by filename (to handle mixed naming conventions)."""
        all_files = []  # list of (group_name, filepath)
        
        # Preface first
        preface_dir = os.path.join(self.data_dir, 'Preface') if self.data_dir else None
        if preface_dir and os.path.isdir(preface_dir):
            preface_files = sorted(glob.glob(os.path.join(preface_dir, '*.txt')),
                                   key=lambda f: self._get_page_number(f))
            for pf in preface_files:
                all_files.append(('Preface', pf))
        
        # Then each PDF group
        for group_name in coll['pdf_groups']:
            group_dir = os.path.join(self.data_dir, group_name) if self.data_dir else None
            if group_dir and os.path.isdir(group_dir):
                group_files = sorted(glob.glob(os.path.join(group_dir, '*.txt')),
                                     key=lambda f: self._get_page_number(f))
                for gf in group_files:
                    all_files.append((group_name, gf))
        
        return all_files


    def get_collection_page(self, collection_id, page_num, page_size=30):
        """
        Get a specific page from a collection.
        ONE TXT FILE = ONE PAGE. Each text page directly corresponds to a PDF page.
        """
        collections = self.list_collections()
        coll = None
        for c in collections:
            if c['id'] == collection_id:
                coll = c
                break
        
        if not coll:
            raise FileNotFoundError(f"Collection not found: {collection_id}")
        
        # Get all page files in order
        all_files = self._get_all_page_files(coll)
        total_pages = len(all_files)
        page_num = max(1, min(page_num, total_pages))
        
        # Read the specific page file
        group_name, filepath = all_files[page_num - 1]
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Extract PDF page number from filename like "page_006.txt"
        filename = os.path.basename(filepath)
        page_match = re.search(r'page[_\s]*(\d+)', filename, re.IGNORECASE)
        pdf_page_num = int(page_match.group(1)) if page_match else page_num
        
        # Build page mapping: one entry per text page
        text_page_mapping = []
        for tp in range(1, total_pages + 1):
            g, fp = all_files[tp - 1]
            fn = os.path.basename(fp)
            pm = re.search(r'page[_\s]*(\d+)', fn, re.IGNORECASE)
            ppn = int(pm.group(1)) if pm else tp
            text_page_mapping.append({
                'text_page': tp,
                'pdf_group': g,
                'pdf_page': ppn,
                'pdf_file': g + '.pdf',
            })
        
        return {
            'collection_id': collection_id,
            'page': page_num,
            'total_pages': total_pages,
            'page_size': page_size,
            'start_line': 1,
            'end_line': len(content.split('\n')),
            'total_lines': len(content.split('\n')),
            'content': content,
            'content_length': len(content),
            'page_mapping': text_page_mapping,
        }


    def load_text(self, file_id):
        """Load a text file by its ID."""
        texts = self.list_texts()
        target = None
        for t in texts:
            if t['id'] == file_id:
                target = t
                break

        if not target:
            raise FileNotFoundError(f"Text not found: {file_id}")

        with open(target['path'], 'r', encoding='utf-8') as f:
            content = f.read()

        self.loaded_text[file_id] = content
        self.current_file = file_id
        return content

    def get_text(self, file_id):
        """Get already loaded text content."""
        return self.loaded_text.get(file_id)

    def get_page_info(self, file_id=None, page_size=30):
        """Get pagination info for a text file."""
        if file_id is None:
            file_id = self.current_file

        if file_id not in self.loaded_text:
            if file_id:
                self.load_text(file_id)
            else:
                return {'total_lines': 0, 'total_pages': 0, 'page_size': page_size}

        text = self.loaded_text.get(file_id, '')
        lines = text.split('\n')
        total_lines = len(lines)
        total_pages = max(1, math.ceil(total_lines / page_size))

        return {
            'total_lines': total_lines,
            'total_pages': total_pages,
            'page_size': page_size,
        }

    def get_page(self, page_num, file_id=None, page_size=30):
        """Get a specific page of text."""
        if file_id is None:
            file_id = self.current_file

        if file_id not in self.loaded_text:
            if file_id:
                self.load_text(file_id)
            else:
                return {'error': 'No text loaded'}

        text = self.loaded_text.get(file_id, '')
        lines = text.split('\n')
        total_lines = len(lines)
        total_pages = max(1, math.ceil(total_lines / page_size))

        page_num = max(1, min(page_num, total_pages))

        start_line = (page_num - 1) * page_size
        end_line = min(start_line + page_size, total_lines)

        page_lines = lines[start_line:end_line]
        page_content = '\n'.join(page_lines)

        return {
            'file_id': file_id,
            'page': page_num,
            'total_pages': total_pages,
            'page_size': page_size,
            'start_line': start_line + 1,
            'end_line': end_line,
            'total_lines': total_lines,
            'content': page_content,
            'content_length': len(page_content),
        }

    def search(self, query, file_id=None, context_chars=60):
        """Search for query in text."""
        if file_id is None:
            file_id = self.current_file

        if file_id not in self.loaded_text:
            if file_id:
                self.load_text(file_id)
            else:
                return []

        text = self.loaded_text.get(file_id, '')
        if not text:
            return []

        page_size = 30
        lines = text.split('\n')

        results = []
        pattern = re.compile(re.escape(query))
        for match in pattern.finditer(text):
            start = max(0, match.start() - context_chars)
            end = min(len(text), match.end() + context_chars)

            context_before = text[start:match.start()]
            context_after = text[match.end():end]

            line_num = text[:match.start()].count('\n') + 1
            page_num = math.ceil(line_num / page_size)

            results.append({
                'word': query,
                'match_start': match.start(),
                'match_end': match.end(),
                'context_before': context_before,
                'context_after': context_after,
                'line': line_num,
                'page': page_num,
                'file_id': file_id,
            })

        return results

    def search_collection(self, query, collection_id, context_chars=60):
        """Search for query in a collection (builds full text on the fly)."""
        collections = self.list_collections()
        coll = None
        for c in collections:
            if c['id'] == collection_id:
                coll = c
                break
        
        if not coll:
            return []
        
        # Build full text
        full_text = ""
        
        # Preface first
        preface_dir = os.path.join(self.data_dir, 'Preface') if self.data_dir else None
        if preface_dir and os.path.isdir(preface_dir):
            preface_files = sorted(glob.glob(os.path.join(preface_dir, '*.txt')))
            for pf in preface_files:
                with open(pf, 'r', encoding='utf-8') as f:
                    full_text += f.read() + '\n'
        
        # Then each PDF group
        for group_name in coll['pdf_groups']:
            group_dir = os.path.join(self.data_dir, group_name) if self.data_dir else None
            if group_dir and os.path.isdir(group_dir):
                group_files = sorted(glob.glob(os.path.join(group_dir, '*.txt')))
                for gf in group_files:
                    with open(gf, 'r', encoding='utf-8') as f:
                        full_text += f.read() + '\n'
        
        if not full_text:
            return []
        
        page_size = 30
        results = []
        pattern = re.compile(re.escape(query))
        for match in pattern.finditer(full_text):
            start = max(0, match.start() - context_chars)
            end = min(len(full_text), match.end() + context_chars)

            context_before = full_text[start:match.start()]
            context_after = full_text[match.end():end]

            line_num = full_text[:match.start()].count('\n') + 1
            page_num = math.ceil(line_num / page_size)

            results.append({
                'word': query,
                'match_start': match.start(),
                'match_end': match.end(),
                'context_before': context_before,
                'context_after': context_after,
                'line': line_num,
                'page': page_num,
                'collection_id': collection_id,
            })

        return results

    def save_collection_page(self, collection_id, page_num, content):
        """Save edited content back to the original text file."""
        collections = self.list_collections()
        coll = None
        for c in collections:
            if c['id'] == collection_id:
                coll = c
                break
        
        if not coll:
            raise FileNotFoundError(f"Collection not found: {collection_id}")
        
        all_files = self._get_all_page_files(coll)
        if page_num < 1 or page_num > len(all_files):
            raise IndexError(f"Page {page_num} out of range (1-{len(all_files)})")
        
        group_name, filepath = all_files[page_num - 1]
        
        # Write the content back to the file
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        
        return filepath

    def upload_text(self, filename, content):

        """Save uploaded text to a temporary location and return its ID."""
        upload_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'uploads')
        os.makedirs(upload_dir, exist_ok=True)

        filepath = os.path.join(upload_dir, filename)
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)

        file_id = f'__upload__{filename}'
        self.loaded_text[file_id] = content
        self.current_file = file_id
        return file_id
