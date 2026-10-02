&nbsp;

# Google Cloud における AI エージェントの多層セキュリティ：リファレンスアーキテクチャ

&nbsp;

![A sleek and modern conceptual illustration for a technical blog post on Layered Security for AI Agents in Google Cloud. At the center, a luminous, glowing AI agent icon or core is protected by multiple concentric, semi-transparent digital shield layers, each representing security controls like Authentication, Model Armor, Access Policies, and Threat Detection. The surrounding environment features abstract Google Cloud aesthetic elements, data flows, and clean network node connections. Professional, highly polished tech aesthetic with modern cloud blue, green, and vibrant accent hues.](https://bufferof.com/en/Blog_Layered_Security_for_AI_Agents_in_Google_Cloud%20_%20A%20Reference%20Architecture/images/image7.jpg)

&nbsp;

## はじめに

2016年9月、著名なセキュリティブロガーである Brian Krebs 氏のサイトが突如としてオフラインになり、彼のブログ「Krebs on Security」にアクセスできなくなるという事態が発生しました。後に明らかになったところによると、同サイトは当時のインターネット史上最大規模となる 620 Gbps の DDoS 攻撃を受け、完全にダウンしていました。その原因は、当時としては極めて高度な脅威であった [Mirai](https://en.wikipedia.org/wiki/Mirai_\(malware\)) と呼ばれるボットネットでした。Mirai ボットネットはワームのように振る舞い、脆弱なセキュリティ設定のままインターネットに公開されていた IoT カメラや家庭用ルーターなどのネットワークデバイスに感染しました。一度デバイスに感染すると、Mirai はそこを踏み台にして他のデバイスをスキャンして感染を広げ、大規模な分散型の攻撃ネットワークを構築しました。感染したこれらのデバイスは中央の C\&C (Command and Control) サーバーに接続し、攻撃者からの指令で攻撃を開始するのを待機していました。ピーク時には、Mirai ボットネットは数十万台のデバイスを制御下に置き、世界中のあらゆる場所からターゲットに向けてランダムなパケットを大量に送りつけることで、前例のない規模の攻撃を可能にしました。

その約1か月後、世界的な主要企業にサービスを提供する大手 DNS サービスプロバイダーの Dyn が同様の攻撃の標的となりました。この攻撃は非常に深刻で、Reddit、Amazon、Netflix といった誰もが知る有名サイトにドメイン名経由でアクセスできなくなりました。後に、Paras Jha、Josiah White、Dalton Norman という3人の学生がこの攻撃の容疑で起訴されました。彼らには金銭的あるいは政治的な動機はなく、単なる興味本位で実験を行っていた若者にすぎませんでした。

&nbsp;

当時はサイバーセキュリティにおいて奇妙な時代であり、多くの大規模な攻撃が明確な動機を持たない才能あるハッカーたちによって、単に「どこまで壊せるか試す」といった目的で仕掛けられていました。それ以来、サイバーセキュリティを取り巻く環境は大きく変化しました。現在でも多くのセキュリティ研究者が悪意なく脆弱性を発見していますが、現代のサイバー攻撃の大部分は悪意のある明確な目的によって引き起こされています。

AI の時代において、サイバーセキュリティの環境はさらに急速に変化しています。サイバーセキュリティは常に、攻撃者が堅牢なシステムを突破するための巧妙な手法を開発し、防御側がそれに合わせた対策で応じるという、ダイナミックな「いたちごっこ」でした。しかし、そこにはいくつかの基本的な不変の前提が存在していました。

* デプロイされたシステムは通常、予測可能かつ決定論的 (deterministic) に動作していたため、世界中のセキュリティチームはシステム自体が予測不能な振る舞いをすることを心配せずに、セキュリティポスチャを設計・実装することができました。  
* 攻撃者も防御側も「人間のスピード」で動く人間でした。通常、防御側は脆弱性の発見から実際のエクスプロイトが出回るまでの間に一定の猶予期間を見込むことができ、即座にダウンタイムを発生させることなくシステムにパッチを適用する時間がありました。

&nbsp;

## 従来のサイバー攻撃の解剖学

&nbsp;

AI がサイバー攻撃の根本的なメカニズムをどのように変えたのかを明確に理解するための前提として、まずは従来の一般的なサイバー攻撃がどのように行われていたのかを振り返っておきたいと思います。

&nbsp;

### **Reconnaissance (偵察)**

このフェーズでは、攻撃者は標的のシステムを調査してアーキテクチャを把握し、既知の脆弱性を持つコンポーネントを特定します。長年にわたり、このステップは高度に自動化されてきました。インターネットに公開されているサービスに既知の脆弱性が含まれている場合、ほぼ確実に発見されます。&nbsp;  
Shodan（現在は商用サービス）のようなツールは、インターネットに公開されているシステムに関する公開情報を収集するために、セキュリティ専門家と攻撃者の双方によって長年利用されてきました。自動化ツールは継続的にスキャンを行っており、これはインターネットからアクセス可能なエンドポイントを絶えず探索し続けるトラフィックの流れを指す「Internet Background Noise (IBN)」として知られる現象です。

&nbsp;

[Struts](https://en.wikipedia.org/wiki/Apache_Struts) は、Web アプリケーションの構築に使用される Java フレームワークです。現在では大部分がモダンなフレームワークに置き換えられていますが、かつては世界中のエンタープライズ環境で広くデプロイされていました。このフレームワークには、CVSS スコアで最大の 10.0 を記録する深刻な脆弱性が存在しました。その悪用は極めて単純で、特別に細工された単一の HTTP リクエストを送信するだけで、サーバー上で任意のリモートコマンド実行が可能になるというものでした。それでもなお、当時は脆弱性の公開から広範な悪用に至るまでには通常ある程度のタイムラグがありました。

&nbsp;

Struts のエクスプロイトが出回っていた頃、私は脆弱なバージョンの Struts を稼働させたクラウド上のハニーポットを設置してみました。そのサーバーは、どこにも公開されておらず、いかなるドメイン名にも紐付けられていない生の IP アドレス経由でのみアクセス可能な状態でした。しかし、わずか 24 時間以内にそのサーバーは侵害されました。空のハニーポットであったため攻撃者が機密データを得ることはありませんでしたが、侵害されたインスタンスは容易にボットネットの一部として組み込まれていた可能性があります。

&nbsp;

絶え間なく発生する Internet Background Noise の量を考えれば、脆弱なシステムは時間の経過とともに必然的に発見されます。エクスプロイトの複雑さに応じて実際に侵害されるかどうかは異なるものの、高度な自動化が進んでいたとはいえ、従来のこのプロセスには依然として人間による関与が大きく残っていました。

&nbsp;

### **Exploit Preparation (エクスプロイトの準備)**

標的システムのマッピングと脆弱性の特定を終えると、攻撃者はエクスプロイトペイロードを構築します。歴史的に、これは高度な技術的スキルを必要とする手作業のプロセスでした。CVSS 10.0 クラスの単一の Remote Code Execution (RCE) の脆弱性が見つからない場合、攻撃者はしばしば複数の比較的深刻度の低い脆弱性（CVSS 6.0 など）を連鎖（チェイニング）させる必要がありました。TCP/IP スタック、CMS プラットフォーム、メールサービス、Web フレームワークにまたがるエクスプロイトを組み合わせるには、高度な専門知識が求められました。その結果、複雑な攻撃は主に極めてスキルの高い個人や、組織化された [Advanced Persistent Threat (APT)](https://en.wikipedia.org/wiki/Advanced_persistent_threat) グループによって実行されていました。

&nbsp;

脆弱性の分析、カスタムコードの記述、ソーシャルエンジニアリングの実施など、エクスプロイトの開発には多大な労力を要したため、攻撃者は大きな金銭的または戦略的見返りが期待できる価値の高い標的に絞って攻撃を行っていました。

&nbsp;

### **Attack and Exploitation (攻撃とエクスプロイトの実行)**

エクスプロイトの準備が整うと、攻撃者は防御のバイパス、検知の回避、ログの消去、そして将来のアクセスのための永続的なバックドアの設置を試みながら侵入を実行します。脆弱なシステムを介した初期アクセスは通常、最初のステップにすぎず、その後、攻撃者はネットワーク内をラテラルムーブメント（横展開）し、権限昇格を行います。ランサムウェアによる迅速な金銭目的から、国家支援型アクターによる長期的なスパイ活動に至るまで、その目的に応じて、攻撃者は内部システムに対する制御を可能な限り長期間かつ最大限に維持しようとします。

&nbsp;

これらのステップが従来のサイバー攻撃の全体像であり、複数の技術領域にわたる専門知識を必要とするリソース集約型のプロセスでした。こうした絶え間ない脅威が存在する中でも、従来は多層防御 (multi-layered defense) 戦略をとることで、企業は運用上のリスクを効果的に軽減することができていました。

&nbsp;

## AI による脅威ランドスケープの拡大

&nbsp;

### **ソフトウェア開発速度の向上 (Software Creation Velocity)**

&nbsp;

AI はコード生成を劇的に加速させました。正式なプログラミング経験を持たない個人でも、コーディングエージェントを使用して機能するソフトウェアを生成できるようになりました。エンタープライズ環境のプロの開発者も同様に AI ツールを活用しており、大手テクノロジー企業ではコードベースの 50% 以上が AI によって生成されていると報告されています。大企業ではセキュリティ基準を維持するための堅牢なコードレビューやテストパイプラインが整備されていることが多い一方で、中小規模の組織や個人の開発者にはこうしたセーフガードが欠けている場合があります。

&nbsp;

[CSAI](https://labs.cloudsecurityalliance.org/wp-content/uploads/2026/04/CSA_research_note_ai_codegen_vulnerability_debt_20260406-csa-styled.pdf) の調査によると、AI ツールによって生成されたコードの 45% から 70% にセキュリティ上の脆弱性が含まれていることが明らかになりました。これは AI が生成したコードを安全にできないという意味ではありませんが、安全性を確保するためには専用のレビュープロセスと防御的なコントロールが必要になります。

&nbsp;

ソフトウェア業界は何十年もの反復を通じてモダンな開発プラクティスを確立し、予測可能なリリースサイクルに合わせてツール、プロセス、エンジニアリングワークフローを調整してきました。AI によって開発速度が加速する中、セキュリティチームは増大するアウトプット量に追いつくために、ツールやガバナンスプロセスを適応させなければなりません。

&nbsp;

インジェクションの欠陥や不適切なアクセス制御といった従来の脆弱性に加え、AI を活用した開発は新たなリスクももたらします。たとえば、モデルのハルシネーション（幻覚）によって実在しないソフトウェアパッケージへの参照が生成されることがあり、これが「Slopsquatting」のようなサプライチェーン攻撃の糸口となる可能性があります。

&nbsp;

### AI によるサイバー攻撃の超加速

&nbsp;

AI は脅威ランドスケープを根本から変えました。従来、攻撃者は偵察を行い、エクスプロイトを構築し、標的型攻撃を実行するために高度な専門知識と手作業の労力に依存しており、そのプロセスは人間の運用上の限界によって制約されていました。

AI は主に以下の点でサイバー攻撃を変革しています。

&nbsp;

**スキルの民主化 (Democratization of skills)**: これまでサイバー攻撃は、必ずしも悪意からではなくとも、何年もかけてシステムをいじり回し、どうすれば突破できるかを探求するような高度なスキルを持つ個人の領域でした。このようなエリートレベルに参入するための障壁は常に非常に高いものでした。しかし AI の登場によってその参入障壁は完全に崩壊し、サイバーセキュリティの経験がまったくない個人でもサイバー攻撃を仕掛けられるようになりました。これは同時に、以前はスキル不足のためにサイバー攻撃に加われなかった悪意ある攻撃者の多くが、もはやそのような障壁なしに攻撃を行えるようになったことを意味します。[調査研究](https://arxiv.org/html/2404.08144v1)によると、AI を用いた既存の脆弱性の悪用は、Metasploit のような従来のツールと比較して非常に高い成功率を示しています。

&nbsp;

**ゼロデイの発見 (Finding zero days)**: 熟練した研究者やハッカーにとって、AI を活用したゼロデイ脆弱性の発見はこれまでよりはるかに効率的になっています。AI は多くの点と点を結びつけることができ、適切にオーケストレーションされた AI エージェントは、以前よりもはるかに高速に新しい脆弱性を発見できます。最近では、Anthropic Mythos、Google Gemini Cyber、OpenAI Astra など、サイバーセキュリティ向けに特化して最適化された多くの AI モデルが開発されています。&nbsp;

Anthropic や [Google](https://cloud.google.com/blog/products/identity-security/cloud-ciso-perspectives-our-big-sleep-agent-makes-big-leap?e=48754805) のような企業は、既存のアプリケーションで発見された[脆弱性](https://www.anthropic.com/news/mozilla-firefox-security)を日常的に報告し、一般公開される前に開発者がパッチを適用する時間を確保しています。セキュリティ業界全体で、多くの研究者が悪意あるアクターと競い合いながらシステムの欠陥を洗い出しています。しかし、高度な AI リソースを手にした悪意ある攻撃者は、防御側の研究者よりもはるかに速くゼロデイ脆弱性を発見する可能性があり、脆弱性が公表されたりパッチが適用されたりする前に悪用されるという、極めて深刻な新しい脅威ベクターが生まれています。

&nbsp;

### 新たなアタックサーフェスとしてのエージェント

より多くの AI エージェントがデプロイされるにつれて、リスクへの露出もそれに伴い増大しています。[OpenAI](https://openai.com/index/hugging-face-incident-and-the-road-ahead/) や [Google](https://techcrunch.com/2026/09/19/googles-gemini-is-the-latest-ai-model-to-hack-other-companies/) に関する最近のセキュリティインシデントは、エージェントがいかに隔離環境 (containment) を抜け出し、承認されていないアクションを実行し得るかを示しています。AI エージェントを保護しつつ、安全な境界内で確実に動作させることは極めて重要な課題となっており、実用的かつ多層防御 (defense-in-depth) のアプローチが求められています。

&nbsp;

従来のアプリケーションセキュリティは、明示的なルールに従う予測可能なシステムを前提としています。対照的に、AI エージェントは動的で自律的であり、作成者が当初想定していた範囲を超える複雑なタスクを処理することができます。しかし、この柔軟性はアタックサーフェス（攻撃対象領域）を拡大させます。タスクを遂行するために、エージェントはエンタープライズシステム、データベース、API へのアクセスを許可する統合ハーネスを必要とします。従来のアプリケーションは境界制限を適用するために厳格なコンテキストベースのアクセス制御に依存していますが、エージェントには特有のガバナンス上の課題が存在します。

&nbsp;

具体的には、AI エージェントは巧妙に細工された Prompt Injection（プロンプトインジェクション）によって操作され、自身の持つ権限を悪用させられる可能性があります。エージェントは正当な認証情報を持って企業ネットワークの境界内部で動作するため、侵害されたエージェントが攻撃者に悪用されると、通常であれば外部からは完全にアクセス不可能なはずの機密性の高い内部データにアクセスされたり、外部へ持ち出されたりする恐れがあります。

&nbsp;

&nbsp;

### Google Cloud における AI エージェントのための多層セキュリティポスチャ

&nbsp;

AI エージェントのセキュリティを確保するには、基盤となるインフラストラクチャのセキュリティと、エージェント固有のリスクの両方に対処する必要があります。エージェントはコンテナ環境やサーバーレス環境内で実行されるため、セキュアな SDLC プラクティス、最小権限のアクセス管理、外部脅威（コマンドインジェクションや SQL インジェクションなど）からの保護、堅牢なロギングといった標準的なアプリケーションセキュリティコントロールは、引き続き不可欠なベースラインとなります。

従来の防御の上に構築されるエージェントセキュリティには、セキュアな Ingress、きめ細かなインタラクションポリシー、そしてセカンダリエージェントや MCP サーバーなどの外部ツールに対する厳格なアウトバウンドアクセス制限といった、特化したコントロールが必要です。

Google Cloud Agent Platform は、AI エージェントをエンドツーエンドで保護するために設計された多層防御アーキテクチャを提供します。

&nbsp;

&nbsp;

&nbsp;

![](https://bufferof.com/en/Blog_Layered_Security_for_AI_Agents_in_Google_Cloud%20_%20A%20Reference%20Architecture/images/image2.png)

&nbsp;

#### Agent Gateway

Agent Gateway は、マイクロサービスにおける API Gateway と同様に機能し、Google Cloud 内の AI エージェントに対する中核的な出入り口（エントリーおよびイグジット）の制御ポイントとしての役割を果たします。これにより、組織は AI エージェントを一元管理し、すべてのエージェント間通信にわたって一貫したセキュリティポリシーを適用できます。

このゲートウェイは、Ingress と Egress の 2 つのモードで動作します。Ingress モードはクライアントや他のエージェントからの受信トラフィックを検査し、Egress モードはエージェントから外部ツール、API、データベース、または MCP サーバーへの送信トラフィックを制御します。Egress 制御を一元化することで、操作されたエージェントが悪意のある目的で未承認の外部エンドポイントへ接続するのを防ぐことができます。

Agent Gateway の実装の詳細については、以前の[ブログ記事](https://medium.com/google-cloud/securing-your-agent-in-agent-platform-with-agent-gateway-and-model-armor-9c1e410b9364)を参照してください。

&nbsp;

&nbsp;

#### Authentication (mTLS)

すべてのエージェントには、SPIFFE 標準（例：`spiffe://` URI プリンシパル）を使用して、暗号学的に検証可能な一意のアイデンティティが割り当てられます。これにより、エージェントのアイデンティティは共有シークレットではなく、検証済みの実行環境に直接紐付けられます。すべての通信において、エンドツーエンドの暗号化と双方向認証のために Mutual TLS (mTLS) が必須となります。Context-Aware Access (CAA) ポリシーは、ツールへのアクセスを許可する前に、エージェントのセキュリティポスチャ、ロケーション、実行状態を動的に評価します。さらに、Gateway は DPoP (Demonstrating Proof-of-Possession) トークンを使用してアクセストークンをエージェントの暗号鍵ペアにバインドし、トークンの窃取やリプレイ攻撃を軽減します。

&nbsp;

&nbsp;

#### Model Armor

Agent Gateway は Google Cloud Model Armor とネイティブに統合されており、受信プロンプトと送信レスポンスをリアルタイムで検査します。Model Armor は受信した指示をアクティブにスキャンし、エージェントのシステム指示を覆そうとする Prompt Injection 攻撃、Jailbreak（脱獄）の試み、および敵対的な操作を検知して無力化します。

![](https://bufferof.com/en/Blog_Layered_Security_for_AI_Agents_in_Google_Cloud%20_%20A%20Reference%20Architecture/images/image3.png)

&nbsp;

#### Threat Detection (Security Command Center)

Security Command Center は、AI ワークロードおよびエージェントのデプロイメント全体にわたって一元的な脅威検知を提供します。以下の機能を使用して、ランタイムリスク、設定ミス、過剰な権限付与を監視します。

**Anomalous Behavior Detection (異常動作の検知)**: 実行中の未承認のシステムコマンド、予期しないツールの呼び出し、異常な API シーケンスを検知してフラグを立てます。

**Deployment & Package Scanning (デプロイメントとパッケージのスキャン)**: Gemini Enterprise Agent Platform 上のエージェントワークロードに対して、デプロイメント設定とコンテナイメージを自動的にスキャンします。

**Secret & Vulnerability Scanning (シークレットと脆弱性のスキャン)**: デプロイ前およびデプロイ中に、露出したハードコードされたシークレットやソフトウェアパッケージの脆弱性を特定します。

**Audit & Oversight Layer (監査と監視レイヤー)**: Agent Runtime 上のエージェントに対して継続的なランタイム監視を提供し、不審なアクティビティが検知された際に実用的な検出結果 (findings) を生成します。

Security Command Center を有効にすることで、セキュリティチームはエージェントのアクティビティを継続的に監視し、異常に対応できるようになります。Security Command Center の統合については、今後の記事で詳しく取り上げる予定です。

![](https://bufferof.com/en/Blog_Layered_Security_for_AI_Agents_in_Google_Cloud%20_%20A%20Reference%20Architecture/images/image1.png)

#### Observability (OTel)

&nbsp;

Agent Runtime は、モニタリング、トラブルシューティング、異常検知をサポートするために詳細な運用テレメトリを収集します。OpenTelemetry (OTel) 標準に基づいて構築されており、テレメトリは以下の 3 つの粒度レベルで整理されています。

&nbsp;

**Session**: 開始からタスク完了までの、エンドツーエンドのユーザーインタラクションサイクルを表します。合計所要時間やトークン消費量などの集計メトリクスは Session レベルで記録されます。

&nbsp;

**Traces**: Session 内の個々のリクエストとレスポンスのインタラクションをキャプチャします。

**Spans**: ツール呼び出し、LLM の呼び出し、Sub-agent へのハンドオフなど、Trace 内の特定のオペレーションを追跡します。

Span: Tool Usage、LLM Call、Sub Agent へのタスク転送など、Trace 内の個別のアクションを表します。これらすべての詳細なアクションの内容が Span の下に記録されます。

&nbsp;

![](https://bufferof.com/en/Blog_Layered_Security_for_AI_Agents_in_Google_Cloud%20_%20A%20Reference%20Architecture/images/image5.png)

&nbsp;

&nbsp;

&nbsp;

&nbsp;

#### Security Policies (Access Policy と Business Policy)

&nbsp;

Security Policies は、ベースとなるエージェントのアプリケーションコードを変更することなく、Google Cloud (GCP) のエージェントデプロイメント全体にわたって一元的なガバナンスを提供します。

&nbsp;

**Access Policy**: 登録されたリソース（Sub-agent、MCP サーバーなど）や外部ネットワークエンドポイントへのエージェントのアクセスを制御する、きめ細かな許可・拒否ルールを定義します。

![](https://bufferof.com/en/Blog_Layered_Security_for_AI_Agents_in_Google_Cloud%20_%20A%20Reference%20Architecture/images/image4.png)

&nbsp;

**Business Policy**: 自然言語によるルールを用いたセマンティックガバナンスを可能にし、エージェントの振る舞いを大規模に制御します。これらのポリシーは、エージェントのコードにビジネスロジックを組み込むことなく、企業の運用ガイドラインに基づいてツールやデータへのアクセスを制限します。

![](https://bufferof.com/en/Blog_Layered_Security_for_AI_Agents_in_Google_Cloud%20_%20A%20Reference%20Architecture/images/image6.png)

&nbsp;

&nbsp;

&nbsp;

## まとめ

多層防御戦略を採用することで、Google Cloud における AI エージェントのレジリエントなセキュリティポスチャを確立できます。Model Armor や Access Policies などのプロアクティブな制御と、継続的な脅威検知、OpenTelemetry による Observability、およびランタイムポリシーの適用を組み合わせることで、組織は新たな脅威を軽減しながら安全にエージェントのデプロイをスケールさせることができます。

&nbsp;

&nbsp;

&nbsp;

## References

&nbsp;

1. [**The Democratization of the DDoS**](https://krebsonsecurity.com/2016/09/the-democratization-of-the-ddos/)  
2. [**KrebsOnSecurity Hit With Record DDoS**](https://krebsonsecurity.com/2016/09/krebsonsecurity-hit-with-record-ddos/)  
3. [**Understanding the Mirai Botnet (USENIX Security '17)**](https://www.usenix.org/conference/usenixsecurity17/technical-sessions/presentation/antonakakis)  
4. [**Justice Department Announces Charges and Guilty Pleas in Mirai IoT Botnet and Click-Fraud Investigations**](https://www.justice.gov/opa/pr/justice-department-announces-charges-and-guilty-pleas-mirai-iot-botnet-and-click-fraud)  
5. [**Analyzing Internet Background Noise (ACM IMC)**](https://dl.acm.org/doi/10.1145/2663716.2663731)  
6. [**NVD \- CVE-2017-5638 Detail (Apache Struts 2 Jakarta Multipart Parser RCE)**](https://nvd.nist.gov/vuln/detail/CVE-2017-5638)  
7. [**Alphabet Q3 2024 Earnings Call Transcript (AI-Generated Code at Google)**](https://abc.xyz/investor/earnings/)  
8. [**Research: Quantifying GitHub Copilot’s Impact on Code Generation and Developer Productivity**](https://github.blog/news-insights/research/research-quantifying-github-copilots-impact-on-developer-productivity-and-happiness/)  
9. [**Cloud Security Alliance AI Safety Initiative (CSAI Foundation): Securing the Agentic Control Plane**](https://cloudsecurityalliance.org/)  
10. [**Asleep at the Keyboard? Assessing the Security of GitHub Copilot's Code Contributions (arXiv:2108.09293)**](https://arxiv.org/abs/2108.09293)  
11. [**AI Package Hallucination: The "Slopsquatting" Threat Vector (SC Media / Vulcan Cyber Research)**](https://www.scworld.com/)  
12. [**Slopsquatting**](https://labs.cloudsecurityalliance.org/research/csa-research-note-slopsquatting-ai-supply-chain-20260419-csa/)  
13. [**LLM Agents can Autonomously Exploit One-day Vulnerabilities (arXiv:2404.08144)**](https://arxiv.org/abs/2404.08144)  
14. [**Teams of LLM Agents can Exploit Zero-Day Vulnerabilities (arXiv:2406.01637)**](https://arxiv.org/abs/2406.01637)  
15. [**SPIFFE: Secure Production Identity Framework for Everyone Specification (CNCF)**](https://spiffe.io/)  
16. [**RFC 9449: OAuth 2.0 Demonstrating Proof-of-Possession at the Application Layer (DPoP)**](https://datatracker.ietf.org/doc/html/rfc9449)  
17. [**Google Cloud: Model Armor Overview and Architecture**](https://cloud.google.com/security/products/model-armor)  
18. [**Google Cloud: Security Command Center (SCC) Threat Detection for AI Workloads**](https://cloud.google.com/security-command-center/docs)

&nbsp;

&nbsp;

