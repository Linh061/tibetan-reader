"""
Tibetan Reader - Flask Backend Application
Provides dictionary lookup, text management, pagination, full-text search,
PDF rendering, and Google Translate (selection-based).
"""

import os
import sys
import json
import glob
import subprocess
import tempfile
import hashlib
import time
from flask import Flask, request, jsonify, send_from_directory, send_file

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dictionary_service import DictionaryService
from text_service import TextService

app = Flask(__name__, 
    static_folder=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'frontend', 'static'),
    template_folder=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'frontend', 'templates'))

# Initialize services
dict_service = DictionaryService()
text_service = TextService()

# PDF directory
PDF_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'pdfs')
# PDF cache directory (rendered PNGs)
PDF_CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'pdf_cache')
os.makedirs(PDF_CACHE_DIR, exist_ok=True)


# Try to import googletrans
try:
    from googletrans import Translator
    google_translator = Translator()
    GOOGLETRANS_AVAILABLE = True
except ImportError:
    GOOGLETRANS_AVAILABLE = False
    print("  ⚠ googletrans not installed. Run: pip install googletrans==4.0.0-rc1")

# ========== Frontend Routes ==========

@app.route('/')
def index():
    """Serve the main page."""
    return send_from_directory(
        os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'frontend', 'templates'),
        'index.html'
    )

@app.route('/reader')
def reader():
    """Serve the reading page."""
    return send_from_directory(
        os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'frontend', 'templates'),
        'reader.html'
    )

@app.route('/static/<path:path>')
def serve_static(path):
    """Serve static files (CSS, JS)."""
    return send_from_directory(
        os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'frontend', 'static'),
        path
    )

# ========== Dictionary API ==========

@app.route('/api/dict/stats')
def dict_stats():
    """Get dictionary statistics."""
    if not dict_service.loaded:
        return jsonify({'error': 'Dictionary not loaded'}), 500
    return jsonify(dict_service.get_stats())

@app.route('/api/dict/lookup')
def dict_lookup():
    """Look up a word in the dictionary.
    Returns exact match if found, along with fuzzy results.
    """
    word = request.args.get('word', '').strip()
    if not word:
        return jsonify({'error': 'No word provided'}), 400
    
    entry = dict_service.lookup(word)
    
    # Always return fuzzy results alongside exact match
    fuzzy_results = dict_service.fuzzy_search(word, max_results=30)
    
    response = {
        'word': word,
        'exact_match': entry,
        'fuzzy_results': fuzzy_results,
        'fuzzy_count': len(fuzzy_results),
    }
    
    if entry:
        return jsonify(response)
    
    return jsonify(response), 404 if not fuzzy_results else 200


@app.route('/api/dict/fuzzy')
def dict_fuzzy():
    """Fuzzy search: find all words containing the query string.
    This is the primary search method - returns results immediately as user types.
    """
    query = request.args.get('q', '').strip()
    if not query:
        return jsonify({'error': 'No query provided'}), 400
    
    results = dict_service.fuzzy_search(query, max_results=50)
    
    return jsonify({
        'query': query,
        'results': results,
        'total': len(results),
    })


@app.route('/api/dict/lookup-batch', methods=['POST'])
def dict_lookup_batch():
    """Look up multiple words at once."""
    data = request.get_json()
    if not data or 'words' not in data:
        return jsonify({'error': 'No words provided'}), 400
    
    results = dict_service.lookup_batch(data['words'])
    return jsonify(results)

@app.route('/api/dict/words')
def dict_words():
    """Get all dictionary words (for frontend caching)."""
    if not dict_service.loaded:
        return jsonify({'error': 'Dictionary not loaded'}), 500
    return jsonify(dict_service.get_all_words())

@app.route('/api/dict/entries')
def dict_entries():
    """Get all dictionary entries."""
    if not dict_service.loaded:
        return jsonify({'error': 'Dictionary not loaded'}), 500
    return jsonify(dict_service.get_all_entries())

@app.route('/api/dict/inline-translate')
def dict_inline_translate():
    """Translate Tibetan text inline, returning segments with translations."""
    text = request.args.get('text', '').strip()
    if not text:
        return jsonify({'error': 'No text provided'}), 400
    
    segments = dict_service.inline_translate(text)
    return jsonify({
        'text': text,
        'segments': segments,
        'total_segments': len(segments),
    })

# ========== Google Translate API ==========

@app.route('/api/translate', methods=['POST'])
def translate():
    """Translate Tibetan text to Chinese using Google Translate."""
    if not GOOGLETRANS_AVAILABLE:
        return jsonify({'error': 'Google Translate not available. Install: pip install googletrans==4.0.0-rc1'}), 501
    
    data = request.get_json()
    if not data or 'text' not in data:
        return jsonify({'error': 'No text provided'}), 400
    
    text = data['text']
    if not text.strip():
        return jsonify({'error': 'Empty text'}), 400
    
    try:
        # Use auto-detection (src not specified) since googletrans doesn't accept 'bo' as source
        result = google_translator.translate(text, dest='zh-cn')
        return jsonify({
            'original': text,
            'translated': result.text,
            'pronunciation': getattr(result, 'pronunciation', None),
            'detected_lang': getattr(result, 'src', None),
        })
    except Exception as e:
        return jsonify({'error': f'Translation failed: {str(e)}'}), 500

# ========== Collections API ==========

@app.route('/api/collections')
def list_collections():
    """List all text collections."""
    collections = text_service.list_collections()
    return jsonify(collections)

@app.route('/api/collections/<collection_id>/page')
def collection_page(collection_id):
    """Get a page from a collection."""
    page = request.args.get('page', 1, type=int)
    size = request.args.get('size', 30, type=int)
    
    try:
        result = text_service.get_collection_page(collection_id, page, size)
        return jsonify(result)
    except FileNotFoundError as e:
        return jsonify({'error': str(e)}), 404

# ========== PDF API ==========

@app.route('/api/pdf/list')
def pdf_list():
    """List all available PDF files."""
    if not os.path.isdir(PDF_DIR):
        return jsonify([])
    
    pdfs = []
    for f in sorted(os.listdir(PDF_DIR)):
        if f.endswith('.pdf'):
            pdf_path = os.path.join(PDF_DIR, f)
            pdfs.append({
                'name': f,
                'id': f.replace('.pdf', ''),
                'size': os.path.getsize(pdf_path),
            })
    return jsonify(pdfs)

def _get_pdf_cache_path(pdf_name, page_num):
    """Get the cache file path for a rendered PDF page."""
    # Create a unique cache key based on pdf name and page
    safe_name = pdf_name.replace('.pdf', '').replace('/', '_')
    return os.path.join(PDF_CACHE_DIR, f'{safe_name}_p{page_num:04d}.png')

def _render_pdf_page(pdf_path, pdf_name, page_num):
    """Render a PDF page to PNG and cache it. Returns the cache path."""
    cache_path = _get_pdf_cache_path(pdf_name, page_num)
    
    # Return cached version if it exists
    if os.path.exists(cache_path):
        return cache_path
    
    # Render using pdftoppm
    with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as tmp:
        tmp_path = tmp.name
    
    base_path = tmp_path.replace('.png', '')
    
    result = subprocess.run(
        ['pdftoppm', '-f', str(page_num), '-l', str(page_num),
         '-r', '150', '-png', pdf_path, base_path],
        capture_output=True, text=True, timeout=30
    )
    
    if result.returncode != 0:
        raise RuntimeError(f'pdftoppm failed: {result.stderr}')
    
    output_files = glob.glob(base_path + '-*.png')
    if not output_files:
        raise RuntimeError(f'Failed to render page {page_num}')
    
    # Move to cache
    os.rename(output_files[0], cache_path)
    
    # Clean up temp file if it still exists
    try:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
    except:
        pass
    
    return cache_path

@app.route('/api/pdf/page')
def pdf_page():
    """Render a specific page of a PDF as PNG image (with caching)."""
    pdf_name = request.args.get('file', '')
    page_num = request.args.get('page', 1, type=int)
    
    if not pdf_name:
        return jsonify({'error': 'No PDF file specified'}), 400
    
    if not pdf_name.endswith('.pdf'):
        pdf_name += '.pdf'
    
    pdf_path = os.path.join(PDF_DIR, pdf_name)
    if not os.path.exists(pdf_path):
        return jsonify({'error': f'PDF not found: {pdf_name}'}), 404
    
    try:
        cache_path = _render_pdf_page(pdf_path, pdf_name, page_num)
        return send_file(cache_path, mimetype='image/png')
    except Exception as e:
        return jsonify({'error': f'PDF rendering failed: {str(e)}'}), 500


@app.route('/api/pdf/info')
def pdf_info():
    """Get info about a PDF file (page count, etc.)."""
    pdf_name = request.args.get('file', '')
    
    if not pdf_name:
        return jsonify({'error': 'No PDF file specified'}), 400
    
    if not pdf_name.endswith('.pdf'):
        pdf_name += '.pdf'
    
    pdf_path = os.path.join(PDF_DIR, pdf_name)
    if not os.path.exists(pdf_path):
        return jsonify({'error': f'PDF not found: {pdf_name}'}), 404
    
    try:
        # Use pdfinfo to get page count
        result = subprocess.run(
            ['pdfinfo', pdf_path],
            capture_output=True, text=True, timeout=15
        )
        
        info = {}
        for line in result.stdout.split('\n'):
            if ':' in line:
                key, val = line.split(':', 1)
                info[key.strip()] = val.strip()
        
        pages = int(info.get('Pages', 0))
        
        return jsonify({
            'name': pdf_name,
            'pages': pages,
            'info': info,
        })
    
    except Exception as e:
        return jsonify({'error': f'Failed to get PDF info: {str(e)}'}), 500

# ========== Text API ==========

@app.route('/api/text/list')
def text_list():
    """List all available text files."""
    texts = text_service.list_texts()
    return jsonify(texts)

@app.route('/api/text/load')
def text_load():
    """Load a text file by ID (full content)."""
    file_id = request.args.get('id', '')
    if not file_id:
        return jsonify({'error': 'No file ID provided'}), 400
    
    try:
        content = text_service.load_text(file_id)
        return jsonify({
            'id': file_id,
            'content': content,
            'length': len(content),
        })
    except FileNotFoundError as e:
        return jsonify({'error': str(e)}), 404

# ========== Pagination API ==========

@app.route('/api/text/page')
def text_page():
    """Get a specific page of text."""
    file_id = request.args.get('id', '')
    page = request.args.get('page', 1, type=int)
    size = request.args.get('size', 30, type=int)
    
    if not file_id:
        if text_service.current_file:
            file_id = text_service.current_file
        else:
            return jsonify({'error': 'No file selected'}), 400
    
    try:
        result = text_service.get_page(page, file_id=file_id, page_size=size)
        return jsonify(result)
    except FileNotFoundError as e:
        return jsonify({'error': str(e)}), 404

@app.route('/api/text/page-info')
def text_page_info():
    """Get pagination info for a text file."""
    file_id = request.args.get('id', '')
    size = request.args.get('size', 30, type=int)
    
    if not file_id:
        if text_service.current_file:
            file_id = text_service.current_file
        else:
            return jsonify({'error': 'No file selected'}), 400
    
    try:
        info = text_service.get_page_info(file_id=file_id, page_size=size)
        return jsonify(info)
    except FileNotFoundError as e:
        return jsonify({'error': str(e)}), 404

# ========== Search API ==========

@app.route('/api/text/search')
def text_search():
    """Search for text in the loaded document or collection."""
    query = request.args.get('q', '').strip()
    file_id = request.args.get('file', None)
    collection_id = request.args.get('collection', None)
    
    if not query:
        return jsonify({'error': 'No search query provided'}), 400
    
    if collection_id:
        results = text_service.search_collection(query, collection_id)
    else:
        results = text_service.search(query, file_id=file_id)
    
    return jsonify({
        'query': query,
        'total': len(results),
        'results': results,
    })

# ========== Save/Edit API ==========

@app.route('/api/texts/save', methods=['POST'])
def text_save():
    """Save edited text content back to the original file."""
    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data provided'}), 400
    
    collection_id = data.get('collection_id')
    page_num = data.get('page_num')
    content = data.get('content')
    
    if not collection_id or not page_num or content is None:
        return jsonify({'error': 'Missing required fields: collection_id, page_num, content'}), 400
    
    try:
        text_service.save_collection_page(collection_id, page_num, content)
        return jsonify({'success': True, 'message': f'第{page_num}页已保存'})
    except Exception as e:
        return jsonify({'error': f'保存失败: {str(e)}'}), 500

# ========== Upload API ==========


@app.route('/api/text/upload', methods=['POST'])
def text_upload():
    """Upload a text file."""
    if 'file' in request.files:
        file = request.files['file']
        filename = file.filename
        content = file.read().decode('utf-8')
    elif request.is_json:
        data = request.get_json()
        filename = data.get('filename', 'pasted_text.txt')
        content = data.get('content', '')
    else:
        return jsonify({'error': 'No file or content provided'}), 400
    
    file_id = text_service.upload_text(filename, content)
    return jsonify({
        'id': file_id,
        'filename': filename,
        'length': len(content),
    })

# ========== Error Handlers ==========

@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(500)
def server_error(e):
    return jsonify({'error': 'Internal server error'}), 500

# ========== Main ==========

def main():
    # Load Chinese dictionary on startup
    print("Loading Chinese dictionary...")
    try:
        dict_service.load()
        print(f"  ✓ Chinese dictionary loaded: {dict_service.total_entries} entries")
    except Exception as e:
        print(f"  ✗ Failed to load Chinese dictionary: {e}")

    # Load English dictionary on startup
    print("Loading English dictionary...")
    try:
        dict_service.load_en_dict()
    except Exception as e:
        print(f"  ✗ Failed to load English dictionary: {e}")

    
    # List available texts
    texts = text_service.list_texts()
    print(f"Available texts: {len(texts)} files")
    for t in texts:
        print(f"  - {t['name']} ({t['type']})")
    
    # Check PDFs
    if os.path.isdir(PDF_DIR):
        pdfs = [f for f in os.listdir(PDF_DIR) if f.endswith('.pdf')]
        print(f"Available PDFs: {len(pdfs)} files")
    
    # Start server
    print("\nStarting Tibetan Reader server...")
    print("  Open http://127.0.0.1:5000 in your browser")
    app.run(host='127.0.0.1', port=5000, debug=True)

if __name__ == '__main__':
    main()
