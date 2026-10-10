# Google Cloud & Google AI 最新アップデート：2026年9月


Google Cloud および Google AI の月次アップデートまとめへようこそ。今月は、Gemini 4 シリーズ初のフロンティアモデルであり 100 万トークンの出力ウィンドウを備えた **Gemini 4 Argon** の登場から、AI エージェント向けに特化して構築された新しいサーバーレスおよび Kubernetes ランタイムまで、長期的なエージェントワークフローの構築、保護、スケーリングを支援するリリースが多数発表されました。

![](https://raw.githubusercontent.com/haren-bh/harenblogs/refs/heads/main/md/images/Google_Cloud_updates_Oct_2.jpeg)

### 今月のハイライト

* **フロンティアモデルと高効率モデル:** 100 万出力トークン上限と 50% オフの導入記念特別価格を提供する **Gemini 4 Argon** が登場したほか、**Gemini 3.8 Flash**（Long-Term GA へ移行）、**Gemini 3.8 Flash Cyber**、Live Avatar を備えた **Gemini 3.8 Live**（一般提供開始：GA）、および **Gemini 3.8 Flash TTS**（パブリックプレビュー）が発表されました。
* **エージェント開発者体験（DX）:** マルチターンのエージェント状態管理を統合するインターフェースとして **Gemini Interactions API** が標準化され、**Antigravity 2.0** にはピアツーピアのサブエージェント間メッセージングと新しい Customizations マーケットプレイスが追加されました。また、**Google Cloud Developer Plugin** により、主要な AI コーディングツールで Google Cloud のスキルを即座に利用できるようになりました。
* **エージェント向けクラウド＆データインフラ:** **Cloud Run** にファーストクラスの Agent Identity が導入され、**GKE Agent Sandbox** がエージェント強化学習で最大 45 倍の高速実行を実現して一般提供開始（GA）となりました。さらに、**AlloyDB** はマネージド MCP サーバー統合とゼロコピーの BigQuery フェデレーションを追加し、**Cloud KMS Autokey** は新たに 11 のサービスへ GA サポートを拡大しました。
* **デバイス、生産性向上、グローバル展開:** 新型ノート PC **Googlebook** の予約注文が開始され、Windows ネイティブ版の **Gemini アプリ** が新しい **Connected Apps（連携アプリ）** とともにリリースされました。


---

## フロンティア AI とマルチモーダルモデル

### Gemini 4 Argon：長期ワークフロー全体にわたる深い推論

Gemini 4 シリーズ初のフロンティアモデルとして登場した **Gemini 4 Argon** は、ソフトウェアエンジニアリング、エンタープライズの知識業務（財務、法務、税務）、および防御的サイバーセキュリティにおける複雑で多段階のワークフロー全体で、深い推論を持続できるよう特化して構築されています。Argon は段階的に展開されており、Fairwind プログラムに参加する信頼されたサイバー防衛担当者への提供から始まり、有料 API ユーザーや Google AI Ultra サブスクリプション登録者へと順次拡大されます。

期間限定の導入記念特別価格として、Gemini 4 Argon は標準価格（入力 $4.00 / 出力 $20.00）から **50% オフ** となる **入力 100 万トークンあたり $2.00**、**出力 100 万トークンあたり $10.00** で提供され、**キャッシュされた入力トークンには 95% の割引** が適用されます。

**主な機能とベンチマークのハイライト:**
* **100 万出力トークン容量:** 100 万トークンの入力コンテキストウィンドウに加え、最大出力容量が従来の 64K から **100 万出力トークン** へと大幅に拡張されました。これにより、モデルは十分な余裕を持って深く推論し、1 回のパスで数十万トークンを生成できます。
* **長期的なソフトウェアエンジニアリングと最適化:** **DeepSWE v1.1** で最高水準（SOTA）となる **77.9%** を達成しました。オープンソースの動画デコーダ `libgav1` におけるベンチマークでは、プロファイルガイド付きコンパイラ実験を通じて手作業でチューニングされた 32,000 行の SIMD コードを置き換え、従来の Rust 移植版よりも **2.7 倍高速** に動作する安全で自動ベクトル化された Rust コードを生成しました。
* **エンタープライズ知識業務とマルチモーダル理解:** GDP 加重の **Vals Index**、**Vals Finance Agent v2**、および **Harvey の Legal Agent Benchmark** で首位に立ち、Zapier のエンドツーエンドベンチマーク **AutomationBench** でも第 1 位（**51.3%**）を獲得しました。マルチモーダル推論では、長尺動画理解の **LVBench** で新記録（**91.7%**）を樹立し、複雑なチャート分析や複数ドキュメントの統合においても卓越した性能を発揮します。
* **科学研究と量子最適化:** 量子コンピューティング研究において、ボトルネックとなっていた量子サブルーチンの時空間リソース（`量子ビット × ゲート数`）を最適化し、公開されているベースラインを **わずか数分で 40% 上回る** 成果を上げました。
* **防御的サイバーセキュリティとプロンプトインジェクション耐性:** **CWE-bench v1** で第 1 位タイ（**68%**）を記録し、**Gray Swan Indirect Prompt Injection (IPI)** ベンチマークで首位を獲得しました。また、**Wiz の Scan for Good** イニシアチブを通じて、医療ソフトウェアの重大な脆弱性の特定とパッチ適用に貢献しました。

**詳細はこちら:** [Gemini 4 Argon 発表ブログ](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-4-argon/) | [Gemini Enterprise Agent Platform の料金](https://cloud.google.com/gemini-enterprise-agent-platform/pricing) | [Google AI 月次まとめ](https://blog.google/innovation-and-ai/technology/ai/google-ai-updates-september-2026/)



### Gemini 3.8 Live（Live Avatar 対応、一般提供開始）

Gemini Enterprise にて 97 言語で一般提供開始（GA）となった **Gemini 3.8 Live** は、リアルタイムかつ低遅延の Speech-to-Speech（音声対音声）インタラクションと、自然なリップシンクを行う **Live Avatar** を組み合わせて提供します。また、ライブカメラや画面のストリーミングに加え、バックグラウンドでの非同期ツール実行もサポートしており、開発者は応答性に優れたリアルなマルチモーダル顧客アシスタントや社内アシスタントを構築できます。

**詳細はこちら:** [Cloud Blog 一般提供発表](https://cloud.google.com/blog/products/ai-machine-learning/gemini-3-8-live-with-live-avatar-is-now-generally-available) | [Google Blog 記事](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-8-live-gemini-3-8-live-extended-thinking/) | [Gemini 3.8 Live ドキュメント](https://cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-8-live)



## エージェント開発ツールと API

### Gemini Interactions API

**Gemini Interactions API** が Gemini Enterprise Agent Platform でネイティブサポートされ、エージェントモデルのデフォルトの対話インターフェースとなりました。マルチターンの会話状態管理、非同期ツール呼び出し、マルチモーダルストリーミングを単一の標準化された API サーフェスに統合し、ステートフルなエージェントのオーケストレーションを簡素化します。

**詳細はこちら:** [Gemini Interactions API ガイド](https://cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/interactions) | [Interactions API リファレンス](https://cloud.google.com/gemini-enterprise-agent-platform/reference/models/interactions-api)

### Antigravity 2.0（v2.18.1 & v2.19.1）

**Antigravity 2.0** の最新アップデート（バージョン **2.18.1** および **2.19.1**）では、マルチエージェントのコラボレーションと拡張性が強化されました。エージェントは直接的なピアツーピアのサブエージェント間メッセージングを通じて通信し、複雑で並列的なエンジニアリングワークフローを調整できるようになりました。また、アーティファクトの Markdown から PDF へのネイティブエクスポート機能や、プラグイン、スキル、カスタムエージェントを検索・インストール・管理できるマーケットプレイスを内蔵した新しい **Customizations** エクスペリエンスも導入されています。

**詳細はこちら:** [Antigravity 変更履歴](https://antigravity.google/docs/changelog) | [Google プラグインのカスタムエージェントに関するブログ](https://antigravity.google/blog/custom-agents-in-google-plugins)

### Google Cloud Developer Plugin

**Google Cloud Developer Plugin** は、公式の Google Cloud スキル、Model Context Protocol（MCP）サーバー、カスタムエージェント、およびコンテキストルールを 1 つのパッケージにまとめ、**Antigravity**、**Gemini CLI**、**Claude Code**、**Cursor** に簡単に導入できるようにします。厳選された最新のアーキテクチャパターンとツール統合をコーディングエージェントに備えさせることで、開発者は IDE やターミナル内から Google Cloud サービス全般の専門知識をすぐに活用できます。

**詳細はこちら:** [Google プラグインのカスタムエージェントに関するブログ](https://antigravity.google/blog/custom-agents-in-google-plugins) | [Antigravity ドキュメント](https://antigravity.google/docs/changelog)

---

## クラウド＆エージェントインフラストラクチャ

### Cloud Run のエージェントプラットフォーム機能と Agent Identity

**Cloud Run** に、サーバーレス AI ワークロード向けの専用エージェントプラットフォーム機能が導入されました。その中核となるファーストクラスの **Agent Identity**（`--identity-type=agent-identity`）は、最小権限での認証ときめ細かな監査証跡を実現します。また、エージェントとしてデプロイされたサービスやジョブは **Cloud Agent Registry** に自動登録されるため、エンタープライズ全体での一元的な検出、ガバナンス、ライフサイクル管理が可能になります。

**詳細はこちら:** [Cloud Run エージェントプラットフォーム機能ドキュメント](https://cloud.google.com/run/docs/ai/agent-platform-features) | [IAM Agent Identity の概要](https://cloud.google.com/iam/docs/agent-identity-overview)

### 強化学習向け GKE Agent Sandbox（一般提供開始）

一般提供開始（GA）となった **GKE Agent Sandbox** は、エージェント強化学習（RL）や信頼されていないコードの実行向けに最適化された、高速起動かつ分離されたマイクロ環境を提供し、**実行速度を最大 45 倍高速化** します。本番環境では **Mistral AI** などの組織が GKE Agent Sandbox を採用しており、1 日あたり 100 万以上のサンドボックスをオーケストレーションし、300 万 CPU コア時間以上の強化学習ワークロードへとスケーリングしています。

**詳細はこちら:** [GKE Agent Sandbox でエージェント強化学習を加速（Cloud Blog）](https://cloud.google.com/blog/products/containers-kubernetes/accelerate-agentic-rl-with-gke-agent-sandbox)

### GKE CPU Startup Boost（プレビュー）

プレビュー版として公開された **GKE CPU Startup Boost** は、Kubernetes Pod の初期化時に Cloud Run のようなバースト CPU 容量を提供し、CPU を常時オーバープロビジョニングすることなく、時間がかかるアプリケーションのコールドスタートを高速化します。コンテナの起動が完了すると、CPU リソースは自動的に定常状態の制限値へと引き下げられるため、継続的なコンピューティングコストを効率的に抑えることができます。

**詳細はこちら:** [GKE CPU Startup Boost 発表（Cloud Blog）](https://cloud.google.com/blog/products/containers-kubernetes/gke-cpu-startup-boost-faster-pod-starts-lower-costs)

### AlloyDB：エージェント向け PostgreSQL と BigQuery フェデレーション

**AlloyDB for PostgreSQL** 向けの新しい機能群とオンデマンドトレーニングが公開され、エンタープライズグレードのエージェント用データバックエンドを構築する方法が紹介されています。主なハイライトとして、**Model Armor** で保護されたマネージドリモート MCP サーバーのデプロイ、ハイブリッドなベクトル検索とリレーショナル検索の実行、および PostgreSQL 内から **BigQuery** に対して直接実行できるゼロコピーのフェデレーションクエリが含まれます。

**詳細はこちら:** [AlloyDB におけるエージェント向け PostgreSQL（Cloud Blog）](https://cloud.google.com/blog/products/databases/announcing-postgresql-for-agents-in-alloydb) | [AlloyDB BigQuery フェデレーションドキュメント](https://cloud.google.com/alloydb/docs/choose-access-bigquery-data-from-alloydb) | [Cloud Skills Boost カタログ](https://www.cloudskillsboost.google/catalog)

### Cloud KMS Autokey（GA 拡大）と Well-Architected Framework の更新

**Cloud KMS Autokey** の一般提供（GA）サポートが **新たに 11 の Google Cloud サービス** に拡大され、HSM で保護された顧客管理の暗号鍵（CMEK）のオンデマンドなプロビジョニングが自動化されました。また、**Google Cloud Well-Architected Framework** の最新アップデートでは、将来の予約（Future Reservations）と Flex-start VM を活用したキャパシティプランニングに関する新しい運用準備ガイダンスが追加されました。

**詳細はこちら:** [Cloud KMS Autokey 対応サービス一覧](https://cloud.google.com/kms/docs/autokey-overview#compatible-services) | [Well-Architected Framework — 新着情報](https://cloud.google.com/architecture/framework/whats-new) | [キャパシティプランニングのガイダンス](https://cloud.google.com/architecture/framework/operational-excellence/operational-readiness-and-performance-using-cloudops#plan_and_manage_capacity)

---

## デバイス、生産性向上、グローバル展開

### Googlebook、Windows 版 Gemini アプリ、Connected Apps

デバイスと生産性向上の分野では、新型ノート PC **Googlebook** の予約注文が開始され、Windows デスクトップ向けのネイティブ **Gemini アプリ** がリリースされました。さらに、Gemini アプリに新しい **Connected Apps（連携アプリ）** 統合が追加され、お気に入りのワークスペースや生産性向上ツールからコンテキストをシームレスに取得し、アクションを実行できるようになりました。

**詳細はこちら:** [Googlebook の予約注文](https://blog.google/products-and-platforms/devices/googlebook/pre-order-googlebook/) | [Windows 版 Gemini アプリの提供開始](https://blog.google/innovation-and-ai/products/gemini-app/gemini-app-now-on-windows/) | [Gemini の新しい Connected Apps](https://blog.google/innovation-and-ai/products/gemini-app/new-connected-apps-gemini/)





