#!/usr/bin/env bash
PATH=/usr/bin:/bin
# 고아 PROCESSING 리셋 후 6워커 기동
docker exec ot-postgres psql -U otbrain -d otbrain -c "UPDATE knowledge.nas_document SET exif_status=NULL WHERE exif_status='PROCESSING';"
for i in 1 2 3 4 5 6; do docker start ot-exif-w$i; done
echo "[$(date -u)] EXIF 6 workers started"
