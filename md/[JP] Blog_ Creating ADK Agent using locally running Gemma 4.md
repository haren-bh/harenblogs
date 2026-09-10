# ローカルで動作する Gemma 4 を使用した ADK エージェントの作成 ![](https://bufferof.com/en/Blog_Creating%20ADK%20Agent%20using%20locally%20running%20Gemma%204/images/image1.png)

**シマフクロウ（Blakiston's Fish Owl）、北海道 羅臼**

[Gemma 4](https://deepmind.google/models/gemma/gemma-4/) は、一般的なハードウェア構成のシステム上でもローカル実行できる非常に強力な LLM です。本ブログでは、[Gemma 4](https://deepmind.google/models/gemma/gemma-4/) を活用してローカル環境で ADK (Agent Development Kit) エージェントを構築・実行する方法を探求します。ローカルで [Gemma 4](https://deepmind.google/models/gemma/gemma-4/) を動作させる主な利点は、

# Gemma 4 について

[Gemma 4](https://deepmind.google/models/gemma/gemma-4/) モデルはすべてマルチモーダルであり、テキスト、可変アスペクト比と解像度をサポートする画像（全モデル）、動画、および音声（E2B、E4B、12B モデルでネイティブ対応）を処理できます。モデルは 16-bit、8-bit、4-bit の量子化モデルとして提供されています。

| Gemma Model | Characteristics | BF16 (16-bit) | SFP8 (8-bit) | Q4\_0 (4-bit) |
| :---- | :---- | :---- | :---- | :---- |
| **Gemma 4 E2B** | Multimodal | 11.4 GB | 5.7 GB | 2.9 GB |
| **Gemma 4 E4B** | Multimodal | 17.9 GB | 8.9 GB | 4.5 GB |
| **Gemma 4 12B** | Multimodal | 26.7 GB | 13.4 GB | 6.7 GB |
| **Gemma 4 26B A4B** | Multimodal, MoE | 57.7 GB | 28.8 GB | 14.4 GB |
| **Gemma 4 31B** | Multimodal | 69.9 GB | 34.9 GB | 17.5 GB |

表 1: 各種 Gemma 4 モデル

表 1 は、さまざまなモデルと、各種量子化手法においてモデルを実行するために必要なメモリ量を示しています。

# テストシステムのスペック

テスト環境のスペックは以下の通りです。

**GPU**: Nvidia RTX 4060 8GB  
**CPU**: Ryzen 3900x  
**RAM**: DDR4 48GB  
**OS**: Windows 11  

見ての通り、VRAM は 8GB しかないため、ちょうど良いスイートスポットとなるモデルは E4B 8-bit、E4B 4-bit、そして 12B 4-bit です。そこで、まずは E4B と 12B を試してみることにしました。

Ollama のインストール  
[Gemma 4](https://deepmind.google/models/gemma/gemma-4/) の実行には Ollama を使用しました。Ollama は以下のリンクからインストールできます。

[https://ollama.com/download/windows](https://ollama.com/download/windows)

# Gemma モデルの比較

モデルを選定する前に、Tokens/s の観点からパフォーマンスを確認し、簡単なスモークテストを実施したいと考えました。本ブログでは鳥に関する情報を提供するエージェントを作成するため、鳥に関する非常にマニアックな質問を投げかけてみました。

**オオセグロカモメ (Vega Gull) とセグロカモメ (Herring Gull) の違いは何ですか？**

これは決して網羅的なテストを意図したものではありませんが、もしオオセグロカモメとセグロカモメの違いを答えられる人に出会ったら、その人は非常に博識であると見なせるでしょう。これが今回の比較の基準となりました。

**モデル 1: Gemma 4 26B (4-bit 量子化)**  
このモデルは、Gemma 4 26B パラメータの 4-bit 量子化バージョンです。このモデルには 15GB のメモリ + 20% の作業領域（Working Space）が必要です。私のマシンスペックからすると、かなりギリギリであることが分かります。

**Model**: gemma4:26b (4-bit 量子化モデル)  
**Run Command**: ollama run gemma4:26b \--verbose  
**Prompt**: What is the difference between a Vega Gull and a Herring Gull  
**Satisfactory Answer**: No.  
**Time to First Token**: 8.146811s  
**Prompt Eval Rate**: 4.30 tokens/s  
**Eval Rate**: 17.55 tokens/s  

最初は順調で、*Larus vegae* の分類体系（Taxonomy）は正しく捉えていましたが、詳細についてはすべて間違っていました。ポテンシャルはあるものの、期待した回答には届きませんでした。モデルが VRAM に収まりきらなかったため、パフォーマンスはかなり低速でした。システムの RAM も消費したためです。VRAM とシステム RAM の間でデータを転送する必要が生じたことでモデルの動作はかなり遅くなりましたが、今回のタスクには許容できる速度だと感じました。

**モデル 2: Gemma 4 12B (4-bit 量子化)**  
このモデルは、Gemma 4 12B パラメータの 4-bit 量子化バージョンです。モデルの動作には約 8GB + 20% の作業領域が必要です。トークン生成の面では 26B モデルよりも優れているはずです。

**Model**: gemma4:12b (4-bit 量子化モデル)  
**Run Command**: ollama run gemma4:12b \--verbose  
**Prompt**: What is the difference between a Vega Gull and a Herring Gull  
**Satisfactory Answer**: No  
**Time to First Token**: 911.771ms  
**Prompt Eval Rate**: 39.48 tokens/s  
**Eval Rate**: 7.45 tokens/s  

このモデルは、質問に対する回答の精度としては完全に的を外してしまいました。オオセグロカモメをヨーロッパのカモメと見なしてしまい（実際には東アジアのカモメです）、分類体系も間違っていました。Time to First Token（初回トークン生成時間）は非常に高速（1秒未満）で、Prompt Eval Rate も非常に高速でした。しかし、Eval Rate は期待していたほど速くはありませんでした。何度か試行してみましたが、ほぼ同様の結果となりました。これについては今後さらに調査が必要です。

パフォーマンスをそれほど犠牲にすることなく 26B モデルの方がやや精度が高かったため、エージェント用モデルとして 26B を採用することに決めました。しかし、好奇心から、パフォーマンスは芳しくないとしても正解できるかどうか確認するために、31B モデルも試してみることにしました。

**モデル 3: Gemma 4 31B (4-bit 量子化)**  
このモデルは、Gemma 4 31B パラメータの 4-bit 量子化バージョンです。このモデルには約 20GB のメモリ + 20% の作業領域が必要です。

**Model**: gemma4-31b (4-bit 量子化モデル)  
**Run Command**: ollama run batiai/gemma4:31b \--verbose  
**Prompt**: What is the difference between a Vega Gull and a Herring Gull  
**Satisfactory Answer**: Yes  
**Time to First Token**: 3.900597s  
**Prompt Eval Rate**: 7.43 tokens/s  
**Eval Rate**: 1.21 tokens/s  

Gemma 4 31B モデルは見事に完璧な正解を出しました！ただし、私のマシンでは約 1 token/s と、まさに這うような遅さでした。エージェント用として 31B を実行するのは極めて遅いため、26B モデルを使い続けることにしました。Gemma 4 31B は非常に有能なモデルであり、スペックが許せばぜひ動かしたかったです！

# ADK (Agent Development Kit) のセットアップ

ADK を使用するには、Python の ADK パッケージをインストールする必要があります。推奨される方法は、Python の仮想環境をセットアップすることです。Python 仮想環境をセットアップしたら、次のように pip を使用して ADK をインストールします。

```bash
pip install google-adk
```

# ローカルでエージェントを作成して実行する

1. プロジェクトフォルダ（例: **gemmaagent**）を作成します。  
2. お好みのテキストエディタ（例: Antigravity）でそのフォルダを開きます。  
3. 次のコマンドを実行して、ローカルで [Gemma 4](https://deepmind.google/models/gemma/gemma-4/) を実行します。  

    *ollama run gemma4:26b*  

4. ollama を使って Gemma を起動すると、Ollama は Gemma 4 と通信するための API サーバーを自動的に起動します。  
5. プロジェクトフォルダ内に `agent1` というフォルダを作成し、その中に以下のコードを記述した [agent.py](http://agent.py) ファイルを作成します。  

```python
import os
import sys
import asyncio
import urllib.request
import json

# Ensure UTF-8 output formatting on Windows to prevent Unicode encoding errors
if os.name == 'nt':
    os.environ["PYTHONUTF8"] = "1"
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except AttributeError:
        pass  # Standard streams might not support reconfiguring in all execution contexts

# Import Google ADK and GenAI types
try:
    from google.adk import Agent
    from google.adk.runners import Runner
    from google.adk.sessions.sqlite_session_service import SqliteSessionService
    from google.adk.models.lite_llm import LiteLlm
    from google.genai import types
except ImportError:
    print("[CRITICAL] Google ADK package not found. Please run:")
    print("  pip install google-adk litellm")
    sys.exit(1)

# Monkeypatch Pydantic serialization bug in LiteLlm to exclude llm_client
if hasattr(LiteLlm, "model_fields") and "llm_client" in LiteLlm.model_fields:
    LiteLlm.model_fields["llm_client"].exclude = True

# Constants
OLLAMA_API_BASE = "http://localhost:11434"
DEFAULT_MODEL = "ollama/gemma4:26b"
DB_PATH = "sessions.db"
SESSION_ID = "default_gemma4_session"
USER_ID = "local_developer"

# Configure Environment for LiteLLM
os.environ["OLLAMA_API_BASE"] = OLLAMA_API_BASE
model_connector = LiteLlm(model=DEFAULT_MODEL)
root_agent = Agent(
    name="local_gemma_assistant",
    model=model_connector,
    instruction=(
        "You are a helpful, direct, and concise programming assistant. "
        "You are powered by the local Gemma-4 model via the Google Agent Development Kit (ADK). "
        "Keep your responses focused and technically accurate."
    )
)
```

6. コードから分かるように、LiteLlm オブジェクトがローカルで動作する Gemma 4 に接続し、Gemma 4 を ADK のモデルとして使用できるようにします。  
7. ターミナルを使用してプロジェクトフォルダに移動し、次のコマンドを入力してエージェントを実行します。  

    *adk web*  

8. サーバーはポート 8000 で起動します。  

    ![](https://bufferof.com/en/Blog_Creating%20ADK%20Agent%20using%20locally%20running%20Gemma%204/images/image3.png)  

9. ブラウザで次の URL を入力して、ADK サーバーに接続します。  

    *http://localhost:8000*  

10. 作成したエージェントを選択してテストします。  
    ![](https://bufferof.com/en/Blog_Creating%20ADK%20Agent%20using%20locally%20running%20Gemma%204/images/image2.png)  

本ブログでは、[Gemma 4](https://deepmind.google/models/gemma/gemma-4/) を使用して ADK (Agent Development Kit) でエージェントを作成し、ローカルで実行する方法を探求しました。また、ユースケースに合わせて必要となるモデルの選定プロセスについても確認しました。次回のブログでは、エージェントを外部ツールと完全に連携させ、[Gemma 4](https://deepmind.google/models/gemma/gemma-4/) を活用した実用的なシステムの構築について詳しく解説する予定です。
