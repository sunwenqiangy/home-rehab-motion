# 生产资源采样

`home-rehab-resource-snapshot.timer` 每分钟写入一次主机和 Docker 容器的资源快照，日志保留 30 天并压缩轮转。

在生产服务器查看当天记录：

```bash
tail -300 /var/log/home-rehab-monitor/resource-$(date +%F).log
```

查看定时器状态：

```bash
systemctl status home-rehab-resource-snapshot.timer
systemctl list-timers home-rehab-resource-snapshot.timer
```

安装或更新脚本（以 root 在包含 `scripts/` 与 `infra/` 的目录执行）：

```bash
bash scripts/install-resource-monitor.sh
```

每份快照包含负载、内存与 Swap、根分区、CPU/I/O/内存压力、`vmstat`、前 15 个进程，以及各 Docker 容器 CPU、内存、网络和块 I/O。
