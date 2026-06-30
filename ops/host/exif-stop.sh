#!/usr/bin/env bash
PATH=/usr/bin:/bin
for i in 1 2 3 4 5 6; do docker stop ot-exif-w$i; done
echo "[$(date -u)] EXIF workers stopped"
