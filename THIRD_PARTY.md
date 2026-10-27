# 上游来源与整合说明

## 1. 主系统

- 仓库：https://github.com/ychenfen/badminton-pipeline-repro
- 下载方式：浅克隆；通过 Git LFS 获取 `TrackNet_best.pt`、`yolov8s-pose.pt` 与 `short.mp4`。
- 上游 README 声明代码部分 MIT，权重及视频按原始来源条款使用；上游未提供单独 LICENSE 文件。原始 README 与源码保留在 vendor；来源版本记录于 UPSTREAM_VERSIONS.json，原上游 Git 历史备份在本机 .upstream-git/（不随源码提交）。
- 模型引用：TrackNetV3 (qaz812345/TrackNetV3)、Ultralytics YOLO、ByteTrack。Ultralytics 有其自身许可要求，不因本整合而改变。
- 比赛样本来源：上游 README 标注 POGBADMINTON；仅作为明确标识的本地流程验证素材。申请作品使用学生自己的授权录像。

主系统改动仅在 `scripts/overlay/overlay_player_analytics.py`：

1. 新增 `--track_csv`，逐帧导出近/远端球员的原始单应性米制坐标和观测标志。
2. CSV 不使用小球场展示的扩展或边界夹紧，不将预测/保持位置记为实际观测。
3. 新增 `--hide_stats` 关闭旧运动指标面板，统一采用 analysis.py 的可导出统计口径。

新任务适配器直接调用其 CLI，不调用写入用户主目录的 `run_all_mac.sh`。调用时固定 `--far_half_expand 1.0`，关闭将空中羽毛球投影到地面的小球场球迹。未新增或训练视觉模型。

## 2. 空间统计项目

- 仓库：https://github.com/muhammadyasin79/Badminton_Analytics_Project
- 下载方式：GitHub 官方 main 分支源码压缩包，保留程序、原始 Notebook、说明与 LICENSE。
- Copyright (c) 2026 muhammadyasin79，MIT。完整许可见 `vendor/Badminton_Analytics_Project/LICENSE`。
- 上游源 Notebook 实际文件名为 `notebooks/Badminton Analysis`，不是 README 中展示的 .ipynb 文件名。

`analysis.py` 适配了 Notebook 第 18、19 单元的区域划分（`assign_zone`）、经验转移矩阵、二维位置直方图、凸包及协方差椭圆方法。

适配差异：

- 使用主系统一次推理导出的米制坐标，不再运行第二次检测。
- 不使用观测 min/max 归一化：采用标定后的实际球场尺寸、按各自半场和球网定义前中后区。
- 速度使用真实帧时间，不使用每帧像素距离代替速度或固定像素缩放。
- 不填补缺失观测；删除上游两人复用同一姿态数据的路径；不复制其训练/交互安装单元。
- 单调链凸包处理共线/少量位置时返回零面积，不因 scipy ConvexHull 退化而失败。
- 去掉将观测密度直接称为“控制力”、将平均位置称为“最佳回位”的解释。
- 图表使用从实际运行获得的数据，界面没有预设球员表现或模拟推理结果。

本整合的实际贡献是工作流与数据接口整合、统计适配、结果核查和本地 UI；申请展示应清楚说明这些开源来源，不将预训练模型或原始方法描述为学生独立发明。
