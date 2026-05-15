"""
AI Service for Tibetan Reader
Provides OpenAI-compatible API integration for AI-assisted reading.
Supports any OpenAI-compatible API (OpenAI, DeepSeek, Qwen, Ollama, etc.)
"""

import os
import json
import time
import requests
import threading
from typing import Optional, Generator, List


# Config file path
CONFIG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')
CONFIG_PATH = os.path.join(CONFIG_DIR, 'ai_config.json')

DEFAULT_CONFIG = {
    "api_base": "https://api.openai.com/v1",
    "api_key": "",
    "model": "gpt-4o-mini",
    "system_prompt": "你是一位藏文典籍阅读助手。用户正在阅读藏文《四部医典》等典籍。请用中文回答，简洁准确。对于藏文词汇，请给出中文释义和相关背景知识。",
    "temperature": 0.3,
    "max_tokens": 1024,
}


def load_config() -> dict:
    """Load AI configuration from file."""
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
                config = json.load(f)
                # Merge with defaults to ensure all keys exist
                merged = DEFAULT_CONFIG.copy()
                merged.update(config)
                return merged
        except (json.JSONDecodeError, IOError):
            pass
    return DEFAULT_CONFIG.copy()


def save_config(config: dict) -> None:
    """Save AI configuration to file."""
    os.makedirs(CONFIG_DIR, exist_ok=True)
    # Mask API key in saved config (save as-is, but don't log it)
    with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
        json.dump(config, f, ensure_ascii=False, indent=2)


def test_connection(config: dict) -> tuple[bool, str]:
    """Test the AI API connection by listing models."""
    try:
        headers = {
            "Authorization": f"Bearer {config['api_key']}",
            "Content-Type": "application/json",
        }
        resp = requests.get(
            f"{config['api_base'].rstrip('/')}/models",
            headers=headers,
            timeout=10,
        )
        if resp.status_code == 200:
            data = resp.json()
            models = [m['id'] for m in data.get('data', [])]
            # Check if configured model is available
            model_available = config['model'] in models
            return True, f"连接成功！可用模型: {len(models)} 个" + \
                (f" (已配置模型 {'✓' if model_available else '✗ 未找到'}") + ")"
        else:
            return False, f"连接失败 (HTTP {resp.status_code}): {resp.text[:200]}"
    except requests.exceptions.Timeout:
        return False, "连接超时，请检查API地址是否正确"
    except requests.exceptions.ConnectionError:
        return False, "无法连接，请检查API地址和网络"
    except Exception as e:
        return False, f"连接失败: {str(e)[:200]}"


def chat_completion(
    config: dict,
    messages: list,
    stream: bool = False,
) -> dict:
    """Send a chat completion request to the AI API.
    
    Args:
        config: AI configuration dict
        messages: List of message dicts with 'role' and 'content'
        stream: Whether to use streaming response
    
    Returns:
        Response dict with 'content' key, or a generator if stream=True
    """
    headers = {
        "Authorization": f"Bearer {config['api_key']}",
        "Content-Type": "application/json",
    }
    
    # Build messages with system prompt
    full_messages = [
        {"role": "system", "content": config.get('system_prompt', DEFAULT_CONFIG['system_prompt'])}
    ]
    full_messages.extend(messages)
    
    payload = {
        "model": config['model'],
        "messages": full_messages,
        "temperature": config.get('temperature', 0.3),
        "max_tokens": config.get('max_tokens', 1024),
        "stream": stream,
    }
    
    api_base = config['api_base'].rstrip('/')
    
    if stream:
        return _stream_chat(api_base, headers, payload)
    
    try:
        resp = requests.post(
            f"{api_base}/chat/completions",
            headers=headers,
            json=payload,
            timeout=60,
        )
        
        if resp.status_code != 200:
            error_msg = f"API请求失败 (HTTP {resp.status_code})"
            try:
                err_data = resp.json()
                if 'error' in err_data:
                    error_msg += f": {err_data['error'].get('message', str(err_data['error']))}"
            except:
                error_msg += f": {resp.text[:200]}"
            return {"error": error_msg}
        
        data = resp.json()
        content = data['choices'][0]['message']['content']
        return {"content": content}
    
    except requests.exceptions.Timeout:
        return {"error": "请求超时，请稍后重试"}
    except Exception as e:
        return {"error": f"请求失败: {str(e)[:200]}"}


def _stream_chat(api_base: str, headers: dict, payload: dict) -> Generator[str, None, None]:
    """Stream chat completion response."""
    try:
        resp = requests.post(
            f"{api_base}/chat/completions",
            headers=headers,
            json=payload,
            stream=True,
            timeout=120,
        )
        
        if resp.status_code != 200:
            error_msg = f"API请求失败 (HTTP {resp.status_code})"
            try:
                err_data = resp.json()
                if 'error' in err_data:
                    error_msg += f": {err_data['error'].get('message', str(err_data['error']))}"
            except:
                pass
            yield f"data: {json.dumps({'error': error_msg})}\n\n"
            return
        
        for line in resp.iter_lines():
            if line:
                line = line.decode('utf-8')
                if line.startswith('data: '):
                    data_str = line[6:]
                    if data_str.strip() == '[DONE]':
                        break
                    try:
                        data = json.loads(data_str)
                        if 'choices' in data and len(data['choices']) > 0:
                            delta = data['choices'][0].get('delta', {})
                            if 'content' in delta:
                                yield f"data: {json.dumps({'content': delta['content']})}\n\n"
                    except json.JSONDecodeError:
                        continue
        
        yield "data: [DONE]\n\n"
    
    except Exception as e:
        yield f"data: {json.dumps({'error': str(e)[:200]})}\n\n"


def explain_text(config: dict, text: str, context: str = "") -> dict:
    """Explain a selected Tibetan text passage."""
    prompt = f"请解释以下藏文文本的含义：\n\n{text}"
    if context:
        prompt += f"\n\n上下文背景：{context}"
    prompt += "\n\n请给出：1) 字面翻译 2) 关键术语解释 3) 医学/文化背景（如适用）"
    
    return chat_completion(config, [
        {"role": "user", "content": prompt}
    ])


def ai_translate(config: dict, text: str) -> dict:
    """Translate Tibetan text to Chinese using AI."""
    prompt = f"请将以下藏文翻译为中文：\n\n{text}\n\n直接给出翻译结果，不要额外解释。"
    
    return chat_completion(config, [
        {"role": "user", "content": prompt}
    ])


def summarize_page(config: dict, page_content: str) -> dict:
    """Summarize the content of a page."""
    prompt = f"请总结以下藏文典籍页面的主要内容（用中文）：\n\n{page_content[:2000]}"
    
    return chat_completion(config, [
        {"role": "user", "content": prompt}
    ])


# ===== Chat History Persistence =====

CHAT_HISTORY_DIR = os.path.join(CONFIG_DIR, 'chat_history')
_history_lock = threading.Lock()


def _get_history_path(collection_id: str, page: int) -> str:
    """Get the file path for a specific page's chat history."""
    os.makedirs(CHAT_HISTORY_DIR, exist_ok=True)
    safe_name = collection_id.replace('/', '_').replace('\\', '_')
    return os.path.join(CHAT_HISTORY_DIR, f"{safe_name}_p{page:04d}.json")


def load_chat_history(collection_id: str, page: int) -> List[dict]:
    """Load chat history for a specific collection page.
    
    Returns:
        List of message dicts with 'role' and 'content' keys.
        Returns empty list if no history exists.
    """
    path = _get_history_path(collection_id, page)
    if not os.path.exists(path):
        return []
    
    with _history_lock:
        try:
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                if isinstance(data, list):
                    return data
                return []
        except (json.JSONDecodeError, IOError):
            return []


def save_chat_history(collection_id: str, page: int, messages: List[dict]) -> None:
    """Save chat history for a specific collection page.
    
    Args:
        collection_id: Collection identifier
        page: Page number
        messages: List of message dicts with 'role' and 'content'
    """
    path = _get_history_path(collection_id, page)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    
    with _history_lock:
        try:
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(messages, f, ensure_ascii=False, indent=2)
        except IOError as e:
            print(f"Failed to save chat history: {e}")


def clear_chat_history(collection_id: str, page: int) -> bool:
    """Clear chat history for a specific collection page.
    
    Returns:
        True if history was cleared, False if no history existed.
    """
    path = _get_history_path(collection_id, page)
    if not os.path.exists(path):
        return False
    
    with _history_lock:
        try:
            os.remove(path)
            return True
        except IOError:
            return False


def list_chat_history_pages(collection_id: str) -> List[int]:
    """List all page numbers that have chat history for a collection."""
    os.makedirs(CHAT_HISTORY_DIR, exist_ok=True)
    safe_name = collection_id.replace('/', '_').replace('\\', '_')
    pages = []
    
    try:
        for fname in os.listdir(CHAT_HISTORY_DIR):
            if fname.startswith(f"{safe_name}_p") and fname.endswith('.json'):
                try:
                    page_str = fname[len(safe_name)+2:-5]  # remove prefix "_p" and ".json"
                    page = int(page_str)
                    pages.append(page)
                except (ValueError, IndexError):
                    continue
    except OSError:
        pass
    
    return sorted(pages)

