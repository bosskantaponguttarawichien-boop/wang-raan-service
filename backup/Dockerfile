# วางร้าน — nightly backup job (Railway cron service), build จาก root ของ repo
# PG_MAJOR ต้องตรงกับเวอร์ชันหลักของ PostgreSQL บน Railway:
#   pg_dump ต่ำกว่า server = dump ไม่ได้, สูงกว่า server = restore กลับมีคำสั่งที่ server ไม่รู้จัก
ARG PG_MAJOR=16
FROM postgres:${PG_MAJOR}-alpine
RUN apk add --no-cache aws-cli
COPY backup/backup.sh /usr/local/bin/backup.sh
USER postgres
ENTRYPOINT ["/usr/local/bin/backup.sh"]
