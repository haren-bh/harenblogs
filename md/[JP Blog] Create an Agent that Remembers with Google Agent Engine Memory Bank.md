# **Agent Platform Memory Bank を使用して記憶を持つエージェントを作成する**

熟練したファイナンシャルアドバイザー、パーソナルトレーナー、あるいは研究パートナーと会話している場面を想像してみてください。あなたは自身の目標を語り、背景を共有し、アイデアを議論し、長期的な計画を立てます。そして翌朝、再び彼らに連絡を取ったとき、相手があなたのことを誰かも分からず、何を話したか、どのような決定に共に至ったかをまったく覚えていなかったとしたらどうでしょうか。

LLM は完全に stateless であるため、過去のインタラクションの記録を保持する組み込みのメモリを持っていません。基盤モデル (Foundational Models) はその基礎的な知能や Context Window の容量において飛躍的な進化を遂げてきましたが、生のコンテキストサイズはそのままメモリを意味するわけではありません。真のインテリジェンスには継続性 (continuity) が不可欠です。単発のやり取りにとどまるチャットボットから、自律的でパーソナライズされたデジタルの同僚へと進化するためには、AI Agent に堅牢で本番環境グレードのメモリシステムが必要となります。

本ガイドでは、Google Cloud 上のフルマネージドなコグニティブメモリインフラストラクチャである **Agent Platform Memory Bank** について探求します。Agent Harness の仕組み、Context Engineering の詳細、Short-Term Memory と Long-Term Memory のアーキテクチャの解剖、そして Google の **Agent Development Kit (ADK)** と **Agents CLI** (`google-agents-cli`) を使用して、永続的なメモリを備えたエージェントをゼロから構築する手順を解説します。

&nbsp;

## Agent と Agent Harness の概要

メモリについて掘り下げる前に、モダンな AI Agent とそれをホストするインフラストラクチャについて明確な定義を確立しておく必要があります。

### What Is an Agent? (エージェントとは何か？)

その中核において、**AI Agent** とは Large Language Model (LLM) に以下の能力が付与されたシステムです。

- **Perception:** ユーザーの入力と環境の状態 (state) を解釈する。  
- **Reasoning & Planning:** 複雑な目的を実行可能なステップに分解する（例：ReAct、Chain-of-Thought、または Plan-and-Execute ループ）。  
- **Tool Use (Grounding):** 外部の API、データベース、計算機、およびエンタープライズソフトウェアと対話する。  
- **Execution & Reflection:** 目的に向かって反復処理を行い、ツールの実行結果を観察し、エラーが発生した際には自己修正 (self-correcting) する。

### ![](https://bufferof.com/en/Blog_Create_an_Agent_that_Remembers_with_Google_Agent%20Engine%20Memory%20Bank/images/image3.png)

### What Is an Agent Harness? (エージェントハーネスとは何か？)

生の LLM は、それ単体でシェルコマンドを実行したり、API 呼び出しをまたいで状態を管理したり、エンタープライズのセキュリティ境界を適用したりすることはできません。単なるテキスト入力・テキスト出力の予測エンジンにすぎないためです。

**Agent Harness**（**Agent Runtime** または **Execution Environment** とも呼ばれます）は、エージェントモデルを包み込むソフトウェアのスキャフォールディング（足場）およびコントロールプレーンです。

**![](https://bufferof.com/en/Blog_Create_an_Agent_that_Remembers_with_Google_Agent%20Engine%20Memory%20Bank/images/image4.png)**

&nbsp;

Agent Harness は以下の役割を担います。

1. **Lifecycle Management:** エージェントセッションのインスタンス化、会話ターンの保持、および正常な終了処理 (graceful terminations) の管理。  
2. **Tool Sandboxing:** モデルの Function Call と実行可能なツールの解決、引数の検証、レート制限の適用、および認証情報の保護。  
3. **Guardrails & Safety:** 入出力をインターセプトし、安全ポリシー、コンプライアンスチェック、および Prompt Injection の緩和策を適用。  
4. **Observability & Auditability:** OpenTelemetry のトレース、レイテンシの内訳、トークン消費メトリクス、およびステップごとの推論ログを Cloud Logging や Cloud Trace に出力。  
5. **Memory Orchestration:** プロンプトが LLM に到達する前にターンをインターセプトして関連する過去のコンテキストを取得し、ターン終了後に非同期でファクト（事実情報）を統合 (consolidating)。

Google Cloud エコシステムにおいては、**Agent Platform AI Agent Runtime**（現在は **Gemini Enterprise Agent Platform** の一部）がこのエンタープライズグレードの Agent Harness として機能します。

&nbsp;

## なぜ Agent Memory が重要なのか

&nbsp;

&nbsp;

1M（100万）や 2M（200万）トークン以上の Context Window の時代によくある誤解として、*「Context Window が事実上無制限であるなら、なぜ専用のメモリシステムが必要なのか？リクエストごとにチャット履歴全体をそのまま渡せばいいのではないか？」* という疑問があります。

この疑問は、**Context Engineering** という中核的な専門領域へと直結します。

### 単純な Context Dumping の失敗モード

制限のない会話履歴をそのまま Context Window に直接渡し続けると、運用面および認知面で深刻なボトルネックが発生します。

1. **Context Rot & "Lost in the Middle":** 最先端のフロンティアモデルであっても、何十万トークンもの生の会話トランスクリプトに埋もれると、情報の想起 (recall) や推論の精度が低下します。50 ターン前に示された重要な指示やユーザーの好みが、無関係な社交辞令や中間ツールの出力の中に埋没して薄れてしまいます。  
2. **Quadratic Latency & Throughput Degradation:** Time to First Token (TTFT) はプロンプトのトークン長に応じて増大します。毎ターン 100,000 トークンのチャット履歴を入力するとレイテンシのスパイクが発生し、リアルタイムの対話を行うユーザーの体験を損ないます。  
3. **Escalating Token Economics:** インタラクションのたびに履歴全体を再送信すると、Prompt Caching のミスや API 課金の両面で膨大な量のトークンを消費します。  
4. **Session Boundaries:** ユーザーがブラウザを閉じたり、1週間後に新しいセッションを開始したりすると、インメモリの Context Window は完全にリセットされてしまいます。

![](https://bufferof.com/en/Blog_Create_an_Agent_that_Remembers_with_Google_Agent%20Engine%20Memory%20Bank/images/image5.png)

&nbsp;

### Context Engineering&nbsp;

**Context Engineering** とは、各ターンにおいてモデルに対し、最も情報密度が高く、シグナルが強く、タスクに関連するコンテキストを意図的にキュレーションする技術および科学です。

Context Window を無制限のハードドライブのように扱うのではなく、Context Engineering ではそれを高速な **L1 CPU Cache** のように扱います。

- **Context Window** は、ワーキングレジスタおよび L1 Cache です。  
- **Session Buffer** は、RAM です（高速、一時的、セッションスコープ）。  
- **Memory Bank** は、NVMe 永続ストレージです（永続的、インデックス化、検索可能、セッションをまたいでパーソナライズされる）。

メモリシステムは、中核となるセマンティックなファクトを動的に抽出し、ユーザープロファイルを更新し、一時的な会話のやり取りを破棄して、正確なコンテキスト知識をジャストインタイムで提供することで Context Engineering を支えます。

&nbsp;

## Google Cloud Agent Platform におけるメモリアーキテクチャ

エージェントのメモリは、**Short-Term Memory** と **Long-Term Memory** の 2 つのカテゴリに分類できます。

### ![](https://bufferof.com/en/Blog_Create_an_Agent_that_Remembers_with_Google_Agent%20Engine%20Memory%20Bank/images/image6.png)

### 

### Short-Term Memory (Session Memory)

- **Scope:** 単一の会話セッション ID に紐付けられます。  
- **Contents:** ユーザーとエージェントの直近のスライディングウィンドウのターン、システムプロンプト、中間の思考トレース (thought traces)、およびツール実行の Call/Response ペア。  
- **Storage:** エフェメラルなインメモリキャッシュ、Agent Platform Session Services、または高速な Key-Value ストア（例：Cloud Memorystore / Redis / Firestore）。  
- **Lifecycle:** セッションが期限切れになるか、ユーザーが会話をリセットした時点で破棄またはアーカイブされます。

### Long-Term Memory (Agent Platform Agent Runtime Memory Bank)

- **Scope:** エンティティ（通常は `user_id` またはエンタープライズアカウント）に紐付けられ、数日、数か月、そして異なるセッションをまたいで永続化されます。  
- **Contents:** 抽出されたファクト、エンティティ間の関係、宣言された好み (preferences)、過去の目標、および行動パターン。  
- **Mechanism:**  
  1. **Autonomous Fact Extraction:** 会話が終了した際、またはセッション中の定期的なタイミングで、Gemini を搭載した非同期のバックグラウンドパイプラインがトランスクリプトをレビューします。  
  2. **Memory Reconciliation:** パイプラインは既存のメモリと照らし合わせて新しい発言を評価します。ユーザーが *「最近オースティンからシアトルに引っ越しました」* と言った場合、システムは矛盾する事実を両方保存するのではなく、以前の居住地のファクトを更新します。  
  3. **Vector Indexing & Semantic Search:** 抽出されたメモリは Embedding 化され、マネージドな Vector Index に保存されます。  
  4. **Scoped Isolation:** メモリ空間はユーザーおよびテナントごとに厳密にスコープ分離されており、GDPR/CCPA コンプライアンスを確保し、マルチテナント間のデータ漏洩を防止します。

&nbsp;

## 4\. Long-Term Memory のための Memory Bank のセットアップ

**Agent Platform Agent Runtime Memory Bank** は、Vector Database の手動プロビジョニング、Embedding 抽出スクリプトの記述、あるいはユーザーのファクトに対する Retrieval-Augmented Generation (RAG) パイプラインの設計を必要とせずに、フルマネージドな Long-Term Memory を提供します。

### 主要な前提条件 (Core Prerequisites)

Agent Platform Agent Runtime と Memory Bank を利用するには、プロジェクトで以下の Google Cloud API が有効になっていることを確認してください。

```sh
# Set your active GCP project
gcloud config set project YOUR_PROJECT_ID

# Enable the required APIs
gcloud services enable \
  aiplatform.googleapis.com \
  compute.googleapis.com \
  run.googleapis.com \
  artifactregistry.googleapis.com
```

&nbsp;

上記のコマンドは、[Google Cloud Shell](https://docs.cloud.google.com/shell/docs) または認証済みのローカルの [gcloud](https://docs.cloud.google.com/sdk/docs/install-sdk?_gl=1*1fn8x4b*_up*MQ..*_ga*MTg2MTcxOTYyMS4xNzkwNTgzMTAx*_ga_WH2QY8WWF5*czE3OTA1ODMxMDAkbzEkZzAkdDE3OTA1ODMxMDAkajYwJGwwJGgw&gclid=CjwKCAjwoOjVBhArEiwAUwDak-Qff2I9fiG4yZ8e9YDybVQh-Pl0dpvmsET_wwYcX6iZCw7pknqhYhoC5AkQAvD_BwE&gclsrc=aw.ds) 環境から実行できます。

### 

### ADK における Memory Bank Service のアーキテクチャ

Google の **Agent Development Kit (ADK)** は `VertexAiMemoryBankService`（およびそのネイティブクライアントインターフェース）を公開しており、エージェントのコードとクラウドのメモリインフラストラクチャの間を統合的に橋渡しします。

&nbsp;

![](https://bufferof.com/en/Blog_Create_an_Agent_that_Remembers_with_Google_Agent%20Engine%20Memory%20Bank/images/image9.png)

### 

### メモリ抽出のカスタマイズ (Memory Extraction Customization)

Memory Bank では、**Extraction Scopes** と **Custom Topics** を定義できます。たとえば、エンタープライズ向けの営業エージェントであれば、メモリ抽出の対象を以下に絞ることができます。

- `Budget`  
- `Decision Makers`  
- `Procurement`  
- `Pain Points`

一方、パーソナルアシスタントエージェントであれば、抽出の対象を以下に絞ることができます。

- `Dietary Restrictions`  
- `Frequent Flyer Numbers`  
- `Family Members`  
- `Working Hours`

&nbsp;

## 5\. Agents CLI を使用したエージェントの構築

Google は、スキャフォールディングからローカル実行、評価 (evaluation)、そして Google Cloud Agent Runtime へのデプロイに至るまで、ADK エージェントのライフサイクル全体を効率化するために構築された開発者ツール兼コーディングアシスタントのスキルパッケージである **Agents CLI** (`google-agents-cli`) を提供しています。

### Step 1: Agents CLI のインストールと初期化

`agents-cli` を実行する推奨の方法は、（高性能な Python パッケージマネージャーである `uv` の）`uvx` を使用することです。

```sh
# Setup the Agents CLI and install required developer skills
uvx google-agents-cli setup
```

`setup` コマンドは、Google Cloud の認証 (`gcloud auth application-default login`) を確認し、Python 仮想環境を準備し、専用の Agent Development Kit スキルをコーディングエージェント環境にインストールします。

### Step 2: 新しい ADK プロジェクトのスキャフォールディング

プロトタイプ開発用に設定された `concierge-agent` という名前の新しいエージェントプロジェクトをスキャフォールディングしてみましょう。

```sh
agents-cli scaffold create concierge-agent --prototype --yes
```

生成されたディレクトリ構造を確認してみましょう。

```
concierge-agent/
├── .adk/                   # ADK metadata and environment state
├── pyproject.toml          # Project dependencies (google-adk, google-cloud-aiplatform)
├── README.md               # Quickstart instructions
├── tests/                  # Unit and integration test suites
│   └── test_agent.py
└── src/
    └── concierge_agent/
        ├── __init__.py
        ├── agent.py        # Core agent definition, prompt, and tools
        └── tools.py        # Custom tool implementations
```

### Step 3: 永続メモリを備えたエージェントコードの実装

プロジェクトの依存関係には `google-adk` と Agent Platform SDK が含まれている必要があります。**Agent Platform Memory Bank Service** を活用するように `src/concierge_agent/agent.py` を記述してみましょう。

ご覧のように、ここでは 4 種類の Long-Term Memory トピックを追加しています。

\-`user_preferences`

`-dietary_restrictions`

`-travel_habits`

`-personal_projects`

```py
"""Concierge Agent equipped with Agent Platform Agent Runtime Memory Bank."""

import os
from google.adk.agents import Agent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.adk.memory import VertexAiMemoryBankService
from google.genai import types

PROJECT_ID = os.getenv("GOOGLE_CLOUD_PROJECT", "your-gcp-project-id")
LOCATION = os.getenv("GOOGLE_CLOUD_REGION", "us-central1")

PROJECT_ID = os.getenv("GOOGLE_CLOUD_PROJECT", default_project_id)
LOCATION = os.getenv("GOOGLE_CLOUD_LOCATION", "global")
AGENT_ENGINE_ID = os.getenv("AGENT_ENGINE_ID") or os.getenv(
    "GOOGLE_CLOUD_AGENT_ENGINE_ID"
)

# 1. Initialize the Long-Term Memory Service
# VertexAiMemoryBankService connects directly to the Agent Runtime backend when configured
if AGENT_ENGINE_ID:
    memory_service = VertexAiMemoryBankService(
        project=PROJECT_ID,
        location=LOCATION,
        agent_engine_id=AGENT_ENGINE_ID,
    )
else:
    memory_service = InMemoryMemoryService()


async def generate_memories_callback(callback_context: CallbackContext) -> None:
    """Sends the session's events to Memory Bank for automatic memory generation."""
    try:
        await callback_context.add_session_to_memory()
    except ValueError:
        # Memory service is not attached to this runner (e.g. in basic tests)
        pass
    return None


# 2. Define the Agent Instructions and Tools
agent = Agent(
    name="concierge_agent",
    model="gemini-2.5-pro",
    instruction="""
You are an intelligent, highly personalized executive concierge assistant.
Your goal is to assist the user with recommendations, scheduling, and planning.

CRITICAL INSTRUCTIONS FOR MEMORY:
1. Always consult your recalled memories about the user to personalize your answers.
2. If the user mentions a personal preference, allergy, favorite place, or goal, acknowledge it naturally.
3. Never contradict established user memories unless the user explicitly updates them.
""",
    # The agent preloads memories into context and saves new memories after turns
    tools=[PreloadMemoryTool()],
    after_agent_callback=generate_memories_callback,
)

root_agent = agent
app = App(name="concierge_agent", root_agent=agent)

# 3. Configure the Runner (Agent Harness)
# The Runner orchestrates Session state, Long-Term Memory, and Model Invocation
runner = Runner(
    app=app,
    session_service=InMemorySessionService(),  # Short-term memory buffer
    memory_service=memory_service,  # Long-term persistent Memory Bank
)


def handle_user_message(user_id: str, session_id: str, message_text: str) -> str:
    """Process an incoming turn through the memory-augmented harness.

    Args:
        user_id: The unique identifier for the user (memory scope).
        session_id: The identifier for the current conversational session.
        message_text: The user's input prompt.
    """
    # Execute the turn through the runner.
    # The runner automatically:
    # 1. Retrieves relevant facts from Memory Bank scoped to `user_id`.
    # 2. Injects them into the system context.
    # 3. Executes the agent reasoning loop.
    # 4. Triggers background fact consolidation into the Memory Bank.
    events = runner.run(
        user_id=user_id,
        session_id=session_id,
        new_message=types.Content(
            role="user",
            parts=[types.Part.from_text(text=message_text)],
        ),
    )
    texts = []
    for event in events:
        if event.content and event.content.parts:
            for part in event.content.parts:
                if part.text:
                    texts.append(part.text)
    return "".join(texts)

```

### Step 4: デプロイメント用スキャフォールディングによるプロジェクトの拡張

Google Cloud Agent Runtime へのクラウドデプロイに向けてエージェントを準備するには、`scaffold enhance` コマンドを使用します。

```sh
cd concierge-agent
agents-cli scaffold enhance --deployment-target agent_runtime
```

&nbsp;

### Step 5: エージェントのデプロイ

エージェントを Agent Runtime にデプロイするには、次のコマンドを使用します。

```sh
cd concierge-agent
agents-cli deploy --project YOUR_GCP_PROJECT --region YOUR_GCP_REGION
```

&nbsp;

&nbsp;

## セッションをまたいだメモリライフサイクルのテスト

Google Agent Runtime Memory Bank の威力を確認するために、コールドスタートで分離された **2 つの異なるセッション** にわたってエージェントがどのように振る舞うかを観察してみましょう。

### Session 1: 知識の付与（月曜日の朝）

Agent Runtime にエージェントをデプロイしたら、以下のコードを使用してリモートエージェントを実行します。

&nbsp;

&nbsp;

&nbsp;

```
import argparse
import asyncio
import json
import os
import re
from collections.abc import AsyncGenerator
from pathlib import Path
from typing import Any

import agentplatform


def sanitize_session_id(session_id: str) -> str:
    """Sanitizes session_id to conform to Agent Platform Agent Runtime constraints.

    Agent Runtime requires session_id to contain only lowercase letters, digits,
    and hyphens, starting and ending with an alphanumeric character.
    """
    sanitized = session_id.lower().replace("_", "-")
    sanitized = re.sub(r"[^a-z0-9-]+", "-", sanitized)
    return sanitized.strip("-")


class DeployedAgentClient:
    """Client for interacting with an agent deployed to Agent Platform Agent Runtime."""

    def __init__(
        self,
        remote_agent_runtime_id: str | None = None,
        location: str | None = None,
        metadata_path: str = "deployment_metadata.json",
    ):
        if not remote_agent_runtime_id:
            metadata_file = Path(metadata_path)
            if not metadata_file.exists():
                raise FileNotFoundError(
                    f"Deployment metadata file not found at {metadata_path}. "
                    "Please specify remote_agent_runtime_id explicitly."
                )
            with open(metadata_file) as f:
                metadata = json.load(f)
            remote_agent_runtime_id = metadata["remote_agent_runtime_id"]

        self.remote_agent_runtime_id = remote_agent_runtime_id

        if not location:
            # Parse location from resource name:
            # projects/{project}/locations/{location}/reasoningEngines/{engine_id}
            parts = remote_agent_runtime_id.split("/")
            if len(parts) >= 4 and parts[2] == "locations":
                location = parts[3]
            else:
                location = os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1")

        self.location = location
        self.platform_client = agentplatform.Client(location=self.location)
        self.agent = self.platform_client.agent_engines.get(
            name=self.remote_agent_runtime_id
        )

    async def stream_query(
        self,
        message: str,
        user_id: str,
        session_id: str | None = None,
    ) -> AsyncGenerator[dict[str, Any], None]:
        """Streams events from the deployed agent."""
        valid_session_id = sanitize_session_id(session_id) if session_id else None
        async for event in self.agent.async_stream_query(
            message=message,
            user_id=user_id,
            session_id=valid_session_id,
        ):
            yield event

    async def query(
        self,
        message: str,
        user_id: str,
        session_id: str | None = None,
    ) -> str:
        """Sends a query to the agent and returns the accumulated text response."""
        full_text: list[str] = []
        async for event in self.stream_query(
            message=message,
            user_id=user_id,
            session_id=session_id,
        ):
            if isinstance(event, dict) and event.get("errorCode"):
                raise RuntimeError(f"Error from agent: {event.get('errorMessage')}")

            content = event.get("content", {})
            parts = content.get("parts", [])
            for part in parts:
                text = part.get("text")
                if text:
                    full_text.append(text)

        return "".join(full_text)

    async def add_session_to_memory(
        self,
        user_id: str,
        session_id: str,
    ) -> None:
        """Consolidates events from the specified session into the Agent Platform Memory Bank."""
        valid_session_id = sanitize_session_id(session_id)
        session = await self.agent.async_get_session(
            user_id=user_id,
            session_id=valid_session_id,
        )
        if not session:
            raise ValueError(f"Session {session_id} not found for user {user_id}")
        await self.agent.async_add_session_to_memory(session=session)

    async def search_memory(
        self,
        user_id: str,
        query: str = "*",
    ) -> list[str]:
        """Searches persistent Memory Bank for extracted facts/memories."""
        response = await self.agent.async_search_memory(user_id=user_id, query=query)
        memories = response.get("memories", [])
        facts = []
        for m in memories:
            content = m.get("content", {})
            for part in content.get("parts", []):
                text = part.get("text")
                if text:
                    facts.append(text)
        return facts


async def main():
    parser = argparse.ArgumentParser(description="Call deployed Agent Runtime agent.")
    parser.add_argument(
        "--user-id",
        default="alice_99",
        help="User ID for the session context",
    )
    parser.add_argument(
        "--session-id",
        default="sess_001",
        help="Session ID for the conversation",
    )
    parser.add_argument(
        "--message",
        default=(
            "Hi, I'm Alice. I'm training for the Boston Marathon this spring, \n"
            "      and I adhere to a strict gluten-free pescatarian diet."
        ),
        help="User message to send to the agent",
    )
    parser.add_argument(
        "--record-to-memory",
        action="store_true",
        default=True,
        help="Trigger Memory Bank extraction for this session after the turn",
    )
    parser.add_argument(
        "--search-memory",
        action="store_true",
        help="Search and print memories for the user instead of querying",
    )
    args = parser.parse_args()

    client = DeployedAgentClient()

    if args.search_memory:
        print(f"Searching Memory Bank for user {args.user_id}...")
        facts = await client.search_memory(user_id=args.user_id)
        if not facts:
            print("No memories found.")
        else:
            print("Recorded memories in Memory Bank:")
            for fact in facts:
                print(f"  • {fact}")
        return

    print("Initializing client...")
    print(f"Connected to agent: {client.remote_agent_runtime_id}")
    print(f"Location: {client.location}")
    print(f"User ID: {args.user_id}")
    print(f"Session ID: {args.session_id}")
    print(f"Message: {args.message.strip()}\n")
    print("--- Streaming Agent Response ---")

    async for event in client.stream_query(
        message=args.message,
        user_id=args.user_id,
        session_id=args.session_id,
    ):
        if isinstance(event, dict) and event.get("errorCode"):
            print(f"\n[Error]: {event.get('errorMessage')}")
            continue

        content = event.get("content", {})
        parts = content.get("parts", [])
        for part in parts:
            text = part.get("text")
            if text:
                print(text, end="", flush=True)

    print("\n\n--- End of Response ---")

    if args.record_to_memory:
        print("\nTriggering Memory Bank consolidation...")
        await client.add_session_to_memory(
            user_id=args.user_id, session_id=args.session_id
        )
        print("Memory extraction request submitted successfully.")


if __name__ == "__main__":
    asyncio.run(main())
```

&nbsp;

&nbsp;

&nbsp;

&nbsp;

Session 1 の終了時、**Agent Harness** はターンのトランスクリプトを **Memory Bank background extraction pipeline** に送信します。

Gemini の抽出エンジンは、以下のような構造化されたファクトを抽出します。

![](https://bufferof.com/en/Blog_Create_an_Agent_that_Remembers_with_Google_Agent%20Engine%20Memory%20Bank/images/image8.png)

&nbsp;

### Session 2: Cold Start でのメモリ検索（金曜日の夜）

*Context: `user_id = "alice_99"`, `session_id = "sess_999"`（完全に新しいセッション、クリーンなメモリキャッシュ）*

ここで、ユーザーが自身の食事制限やマラソンのトレーニングについて**一切のコンテキストを提供していない**ことに注目してください。

### ![](https://bufferof.com/en/Blog_Create_an_Agent_that_Remembers_with_Google_Agent%20Engine%20Memory%20Bank/images/image7.png)

### 裏側で何が起きたのか？  ![](https://bufferof.com/en/Blog_Create_an_Agent_that_Remembers_with_Google_Agent%20Engine%20Memory%20Bank/images/image2.png)

1. クライアントは Session Buffer 内の会話ターンがゼロの状態で `sess_999` を開始しました。  
2. Agent Harness がインテント (`dining`, `recovery run`, `Back Bay`) を抽出し、`alice_99` について Memory Bank にクエリを実行しました。  
3. Memory Bank が Alice のメモリベクトルに対して Semantic Search を実行し、彼女のマラソントレーニングと食事制限の要件を抽出しました。  
4. Harness がこれらの統合されたファクトをシステムコンテキストに直接注入しました。  
5. Gemini が、自然で協力的、かつ継続性を感じさせる完全にパーソナライズされたレスポンスを生成しました。

&nbsp;

これは Google Cloud Console でも確認できます。Google Cloud の Agent Platform に移動し、Agents-\>Deployments に進みます。対象のエージェントをクリックし、Memories をクリックすると、以下のように保存されたメモリが表示されます。

&nbsp;

![](https://bufferof.com/en/Blog_Create_an_Agent_that_Remembers_with_Google_Agent%20Engine%20Memory%20Bank/images/image1.png)

&nbsp;

&nbsp;

&nbsp;

## まとめ

AI Agent が目新しいデモンストレーションからミッションクリティカルなエンタープライズワークフローへと進化するにつれて、それらを取り巻くシステムも同様に成熟していく必要があります。

Context Window の拡大のみに依存することは、高コストかつ高レイテンシの罠に陥ることになります。真のエージェント的インテリジェンスには、2 層のメモリモデルによって支えられた **Context Engineering** が不可欠です。

- 会話の俊敏性とマルチステップ推論のスクラッチパッドのための **Short-Term Session Memory**。  
- セッションをまたぐ継続性、パーソナライゼーション、および進化する知識の保持のための **Long-Term Memory Bank**。

**Google Agent Runtime Memory Bank** を使用することで、開発者はカスタムの Vector Database や複雑な ETL パイプラインを構築する負担なしに、関連する知識をシームレスに抽出、統合、インデックス化し、引き出すエンタープライズグレードのフルマネージドメモリインフラストラクチャを利用できるようになります。**Agents CLI** (`google-agents-cli`) および **Agent Development Kit (ADK)** と組み合わせることで、真に記憶を持つエージェントの作成は、もはや数か月に及ぶエンジニアリングプロジェクトではなく、標準的で再現可能なアーキテクチャとなります。

### 参考リソース (Useful Resources)

- [Google Agents CLI Documentation](https://google.github.io/agents-cli/guide/getting-started/)  
- [Google Agents CLI GitHub Repository](https://github.com/google/agents-cli)  
- Gemini Enterprise Agent Runtime [Documentation](https://cloud.google.com/vertex-ai/docs)  
- [Google Agent Development Kit (ADK) Reference](https://cloud.google.com/products/gemini/enterprise)