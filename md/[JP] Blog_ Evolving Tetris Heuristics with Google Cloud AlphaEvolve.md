# **AlphaEvolve を使用してテトリスの NP 完全問題の解法を最適化する**

&nbsp;

## テトリスの NP 完全問題 (Tetris NP-Complete Problem)

子供の頃、何時間も夢中になってテトリスをプレイした経験がある方も多いのではないでしょうか。4つの正方形で構成されたブロックが綺麗に開いた隙間に吸い込まれるように落ち、ブロックのラインが次々と消えていく光景には、何とも言えない心地よさがありました。ブロックを配置するとき、誰もが「ここが本当に最適な場所なのだろうか」と考えます。しかし、次のブロックが1つ、せいぜい2〜3個先までしか見えないため、私たちは深く考えることなく、ほとんど直感的に、穴（隙間）を作らないように配置する貪欲法（Greedy Approach）的なやり方をとりがちです。もし、これから落ちてくるすべてのブロックの並び順が事前に分かっていたとしたら、すべてのブロックを完全に敷き詰め、盤面を完全にクリア（Perfect Clear）にする完璧な戦略を導き出すことはできるでしょうか？  
![](https://bufferof.com/en/Blog_Optimize_Tetris_NP_Complete_solution_with_AlphaEvolve/images/image2.png)

&nbsp;

実は、これは極めて困難な問題であることが分かっています。数学的・計算量理論的にも [NP 完全 (NP-Complete)](https://arxiv.org/pdf/cs/0210020) であることが証明されています。本ブログでは、この問題に対する単純な総当たりアプローチ（ナイーブな Brute Force 解法）が、Google の [AlphaEvolve](https://docs.cloud.google.com/gemini/enterprise/docs/alphaevolve/developer-guide/overview) を活用することで、いかに実用的かつ高性能な解法へと進化させられるかを探求します。&nbsp;

## 

## 

## 1. AlphaEvolve の概要 (Introduction to AlphaEvolve)

ヒューリスティック（Heuristic）エンジニアリングは、歴史的に多大な労力を要する職人技のような分野でした。チェスの評価関数やパケットルーティングアルゴリズム、ゲームプレイングエージェントの設計に至るまで、開発者は係数の手動調整やエッジケースの調整、そして試行錯誤の実験に何週間もの時間を費やしてきました。

**Google DeepMind の** [AlphaEvolve](https://docs.cloud.google.com/gemini/enterprise/docs/alphaevolve/developer-guide/overview) は、進化的アルゴリズム（Evolutionary Algorithm）と大規模言語モデル（LLM）によるプログラム合成（Program Synthesis）を融合させることで、このパラダイムを一変させます。

壊れやすいランダムなビット反転や原始的な抽象構文木（AST: Abstract Syntax Tree）の交叉に依存していた従来の遺伝的アルゴリズムとは異なり、[AlphaEvolve](https://docs.cloud.google.com/gemini/enterprise/docs/alphaevolve/developer-guide/overview) は LLM をインテリジェントでコンテキストを認識する変異（Mutation）および交叉（Crossover）オペレータとして活用します。LLM はコードのセマンティクス（意味論）を深く理解し、非線形スケーリング指数の導入、動的な進行度比率、構造的ヒューリスティックなど、ドメインに特化した改善を提案します。

さらに、厳格で自動化された 3-Tier Evaluation Harness（3層評価ハーネス）と組み合わせることで、[AlphaEvolve](https://docs.cloud.google.com/gemini/enterprise/docs/alphaevolve/developer-guide/overview) は生成された各候補プログラムの安全性、機能的正確性、および実証的パフォーマンスを体系的に検証し、世代を超えて単調増加的な最適化（Monotonic Optimization）を推進します。

&nbsp;

![](https://bufferof.com/en/Blog_Optimize_Tetris_NP_Complete_solution_with_AlphaEvolve/images/image1.png)

Google Cloud で AlphaEvolve を使用するには、まずこちらの [手順 (steps)](https://docs.cloud.google.com/gemini/enterprise/docs/alphaevolve/developer-guide/environment-and-api-access-setup) に従って AlphaEvolve を有効にする必要があります。

## テトリス問題の定義：NP 完全の挑戦 (Tetris Problem Definition: An NP-Complete Challenge)

テトリスは一見すると非常に単純に見えます。しかし 2002 年、計算機科学者の Erik Demaine 氏、Susan Hohenberger 氏、David Liben-Nowell 氏らは、次に出現するブロックの全シーケンスが事前に分かっている「オフライン・テトリス（offline Tetris）」が [**NP 完全 (NP-complete)**](https://arxiv.org/pdf/cs/0210020) であることを証明しました。

ライン消去数の最大化、盤面の高さの最小化、あるいは特定のブロック列でパーフェクトクリア（残存ブロックが 0 の完全な空盤面）を達成できるかどうかの判定には、状態の爆発的な組み合わせ（組合せ爆発: Combinatorial Explosion）の探索が必要となります。

&nbsp;

## 3. AlphaEvolve によるテトリス解法の進化 (Evolving Tetris Solution with AlphaEvolve)

&nbsp;

### 3.1 ナイーブな解法からスタートする (Start with a Naive Solution)

まず、計算量が指数関数的に増大するナイーブな解法から始めます。もしこの解法を 50 個のテトリスブロックに対して実行した場合、解に到達するまでに数十億年もの計算時間を要することになります。実際にこの解法を実行してみたところ、予想通り必要な計算量は指数関数的に急上昇しました。サンプル実行の結果は以下の通りです。

&nbsp;

&nbsp;

&nbsp;

&nbsp;

| Number of Blocks (ブロック数) | Execution Time (実行時間) |
| :---- | :---- |
| 1 | 1.7 ms |
| 2 | 13.1 ms |
| 3 | 195.7 ms |
| 4 | 6.3004s |
| 5 | 125.91s |

&nbsp;

&nbsp;

### 3.2 ナイーブなプログラムをシードとして AlphaEvolve を実行する (Running AlphaEvolve with Naive Program as Seed)

&nbsp;

[AlphaEvolve](https://docs.cloud.google.com/gemini/enterprise/docs/alphaevolve/developer-guide/overview) は数回の進化ループを実行し、元のナイーブな解法よりも遥かに優れたアルゴリズムを生成しました。ナイーブな解法と [AlphaEvolve](https://docs.cloud.google.com/gemini/enterprise/docs/alphaevolve/developer-guide/overview) による解法の実行時間比較は以下の通りです。

&nbsp;

| N (Blocks: ブロック数) | Naive Search Time (ナイーブ探索時間) | AlphaEvolve Runtime (AlphaEvolve 実行時間) |
| :---- | :---- | :---- |
| N \= 1 | 1.06 ms | 1.45 ms |
| N \= 2 | 14.10 ms | 21.55 ms |
| N \= 3 | 250.97 ms | 165.67 ms |
| N \= 4 | 9.12s | 418.84 ms |
| N \= 5 | 125.91s | 1,164.92 ms |
| N \= 6 | \~1.7 hours (Projected) | 679.42 ms |
| N \= 7 | \~1.6 days (Projected) | 947.97 ms |
| N \= 8 | \~37.4 days (Projected) | 953.45 ms |
| N \= 10 | \~54.2 years (Projected) | 1.29 s |
| N \= 12 | \~28,700 years (Projected) | 1.68 s |
| N \= 15 | 3.49 × 10⁸ years (Projected) | 3.48 s |

上の表から分かるように、[AlphaEvolve](https://docs.cloud.google.com/gemini/enterprise/docs/alphaevolve/developer-guide/overview) は極めて効率的な解法を見つけ出し、計算不可能なほど長大な実行時間をわずか数秒にまで短縮することに成功しました。

AlphaEvolve はヒューリスティックにいくつかの変更を加えることで、探索ノードの大幅な枝刈り（Pruning）を実現しました。主な変更点は以下の表にまとめられています。

&nbsp;

| Improvement Factor (改善要因) | Naive Brute-Force Solution (ナイーブな総当たり解法) | AlphaEvolve improved heuristics (AlphaEvolve の改善されたヒューリスティック) | Performance Benefit (パフォーマンス上の利点) |
| :---- | :---- | :---- | :---- |
| Feasibility Testing (実行可能性テスト) | パーフェクトクリア (PC) が不可能と判断する前に、すべての経路を試行する。 | O(1) の割り切れ判定 (40 mod 10 \= 0\) と市松模様の T-piece パリティチェックを実行。 | 即時の Fail-Fast：PC が数学的に不可能な場合、探索木全体をスキップする。 |
| Search Space (Fallback) (探索空間の制限) | すべての順列を探索する完全な幅優先探索または深さ優先探索。 | 各ステップで上位の状態のみを保持するビームサーチ (Beam Search)。 | 計算量を O(B^N) から O(N \* W \* B) (最大約 36,000 回の評価) に削減。 |
| Subtree Pruning (部分木の枝刈り) | デッドスペースが残ったり、積み上がりすぎたりしても手を探索する。 | ゼロホールルール (count\_holes() \> 0\) と厳格な高さ上限カットオフ (max\_height \= 6)。 | 最初の 1–3 個のピース配置の時点で、95% 以上の枝を刈り込む。 |
| State Caching (状態キャッシング) | 異なるピース順序で到達した同一の盤面レイアウトを再評価する。 | 置き換えテーブル (Transposition Tables) を通じて盤面を整数のビットマスク (to\_row\_tuples()) にハッシュ化。 | 可換な配置による冗長な経路計算を排除する。 |
| Piece Rotations (ピースの回転) | 4つの向き (0°, 90°, 180°, 270°) を無作為にすべてテストする。 | 空間座標シグネチャによって同一形状を重複排除する。 | 分岐係数を削減 (例: O-piece は 1 回転、I, S, Z は 2 回転)。 |

&nbsp;

### 3.3 AlphaEvolve Configuration & Parameters (AlphaEvolve の設定とパラメータ)

[AlphaEvolve](https://docs.cloud.google.com/gemini/enterprise/docs/alphaevolve/developer-guide/overview) の最適化プロセスを導くため、状態評価、ヒューリスティックの重み、進化的探索制御にまたがる構造化されたパラメータ空間を定義しました。

&nbsp;

&nbsp;

&nbsp;

| Category (カテゴリ) | Parameter (パラメータ) | Value (値) | Description (説明) |
| :---- | :---- | :---- | :---- |
| **Run Settings (実行設定)** | programmingLanguage | "python" | 変異対象となるヒューリスティックスクリプトの言語。 |
|  | maxPrograms | 100 (default) | キャンペーン全体で生成する候補プログラムの最大上限数。 |
|  | concurrency | 2 (default) | 並行して実行可能な評価数。 |
|  | maxDuration | "86400s" (24 hours) | 実験の絶対的な実行時間制限。 |
|  | idleTimeout | "1800s" (30 minutes) | アクティブなタスクキューのアクティビティがない場合のタイムアウトしきい値。 |
| **Generation Settings (生成設定)** | context | "Optimize the evaluate\_move heuristic function for Tetris board states..." | 目的のメトリクス（消去ライン数、穴、凹凸度、高さ、4ライン消去）を定義する LLM への直接の指示。 |
|  | includeFullProgramInPrompt | TRUE | スニペットではなく、候補スクリプト全体のコンテキストをジェネレータ LLM に提供するようシステムに強制する。 |
|  | models | \[{"name": "gemini-3.5-flash", "weight": 1.0}\] (default) | 生成モデルとそれぞれの確率配分の重みを指定する。 |
| **Evolution Settings (進化設定)** | paretoSamplingProbability | 0 | 多目的パレートフロンティア（Pareto-frontier）基準に基づいて親の解を選択する確率。 |

&nbsp;

## 4. 評価プロセス：3 層の多目的アーキテクチャ (Evaluation Process: A 3-Tier Multi-Objective Architecture)

ゲームプレイのヒューリスティック候補を評価する際には、安全性、計算コスト、および報酬アライメント（Reward Alignment）に関して特有の課題が生じます。これを解決するため、[AlphaEvolve](https://docs.cloud.google.com/gemini/enterprise/docs/alphaevolve/developer-guide/overview) は盤面のトポロジーシミュレーションおよび単調適応度関数（Monotonic Fitness Function）と組み合わせた 3 層の [階層的検証 (hierarchical validation)](https://docs.cloud.google.com/gemini/enterprise/docs/alphaevolve/developer-guide/evaluator-implementation-patterns) ハーネスを採用しています。

### 4.1 3 層の検証パイプライン (The 3-Tier Validation Pipeline)

&nbsp;

* **Tier 1: 静的 AST 解析とセキュリティスクリーニング (Static AST Analysis & Security Screening)**: Python の ast モジュールで構文を検証し、厳格なホワイトリストを強制（I/O 操作、非決定論的呼び出し、グローバル変数の変更などを禁止）するとともに、evaluate\_move 関数のシグネチャを保護します。失敗したプログラムは即座に不合格となります (Fitness \= 0.0)。  
* **Tier 2: 機能契約と不変条件の検証 (Functional Contract & Invariant Validation)**: 有限浮動小数点チェック、極端な盤面構成（空盤面、危険な高さ、不連続な表面）、単調性チェックなどの決定論的スモークテストを実行し、シミュレーション前に不正なヒューリスティックを排除します。  
* **Tier 3: 定量的シミュレーションハーネス (Quantitative Simulation Harness)**: 評価対象の候補は、ビットボード表現上で多様なテストシナリオ（N \= 5〜15）にわたる高スループットなビームサーチ (k \= 200\) をガイドし、最適でないブランチを刈り込みます。

&nbsp;

### 4.2 特徴量抽出と単調適応度式 (Feature Extraction & Monotonic Fitness Formula)

単一のスカラー値を算出するために、主要なトポロジー指標が抽出されます：

* **Average Lines Cleared (L\_avg)**: 平均ライン消去数（主要なゲーム進行指標）。  
* **Perfect Clears (N\_PC)**: パーフェクトクリア数（盤面の完全クリア）。  
* **Survival Rate (R\_survival)**: 生存率（完了したベンチマークシナリオの割合）。  
* **Buried Holes (H\_holes)**: 埋没した穴（閉じ込められた空セル。退行的なプレイを防ぐための重いペナルティ）。  
* **Surface Bumpiness (B\_bumpiness)**: 表面の凹凸度（スカイラインの滑らかさ）。  
* **Max Column Height (H\_max)**: 最大列の高さ（ブロックのピークの高さ）。

&nbsp;

これらの指標は以下の単調適応度式 (Monotonic Fitness Formula) に統合されます：

Fitness \= (150.0 \* L\_avg) \+ (500.0 \* N\_PC) \+ (50.0 \* R\_survival) \- (25.0 \* H\_holes) \- (1.5 \* B\_bumpiness) \- (1.0 \* H\_max)

&nbsp;

* **Anti-Degeneracy (退行防止)**: 埋没した穴に対する \-25.0 の重み付けにより、目先の貪欲なライン消去よりも長期的な構造の健全性が保たれます。  
* **Perfect Clear Super-Bonus (パーフェクトクリアのスーパーボーナス)**: \+500.0 のボーナスにより、盤面の完全なリセットが強力に報奨されます。

&nbsp;

## 5. 結論とポイント (Conclusion & Takeaways)

Google DeepMind の [AlphaEvolve](https://docs.cloud.google.com/gemini/enterprise/docs/alphaevolve/developer-guide/overview) は、LLM によるプログラム合成と進化的最適化を組み合わせることで、ヒューリスティックエンジニアリングにおける革新的な飛躍をもたらします。テトリスの事例研究で実証されたように、[AlphaEvolve](https://docs.cloud.google.com/gemini/enterprise/docs/alphaevolve/developer-guide/overview) は NP 完全の探索空間を効率的にナビゲートし、計算量的に実行不可能であった総当たりアプローチを、評価時間を数年から数秒へと短縮する高性能なヒューリスティックへと進化させました。手作業による試行錯誤を排除し、ドメインに特化したアルゴリズム設計を自動化することで、本フレームワークはソフトウェアエンジニアリング、AI 設計、オペレーションズリサーチにおける複雑な多目的最適化課題を解決するための刺激的な可能性を切り拓きます。
