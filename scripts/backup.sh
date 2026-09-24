#!/bin/bash
# Backups of the Medusa database and its uploads (the `static` volume).
#
#   backup.sh            # loop: back up now, then every BACKUP_INTERVAL_HOURS
#   backup.sh now        # one backup
#   backup.sh list       # list backups
#   backup.sh restore <timestamp>   # restore database and uploads
#   backup.sh health     # healthcheck: last backup is recent enough
#
# Files: /backups/<timestamp>-db.dump (pg_dump custom format) and
# /backups/<timestamp>-static.tar.gz, deleted after BACKUP_KEEP_DAYS days.
set -euo pipefail
# Backups contain password hashes and customer data: owner-only files.
umask 077

BACKUP_DIR=/backups
UPLOADS=/static
# Owner of the uploads: the `node` user of the Medusa image.
APP_UID=1000 APP_GID=1000
export PGHOST="${DB_HOST}" PGPORT="${DB_PORT}" PGUSER="${DB_USER}" PGPASSWORD="${DB_PASSWORD}"

backup() {
    local ts tmp
    ts="$(date -u +%Y%m%dT%H%M%SZ)"
    echo "==> Backup ${ts}"
    tmp="${BACKUP_DIR}/.${ts}"
    pg_dump --format=custom --no-owner --dbname="${DB_NAME}" --file="${tmp}-db.dump"
    if [ -d "${UPLOADS}" ]; then
        tar -C "${UPLOADS}" -czf "${tmp}-static.tar.gz" .
    else
        tar -C "$(mktemp -d)" -czf "${tmp}-static.tar.gz" .
    fi
    mv "${tmp}-db.dump" "${BACKUP_DIR}/${ts}-db.dump"
    mv "${tmp}-static.tar.gz" "${BACKUP_DIR}/${ts}-static.tar.gz"
    find "${BACKUP_DIR}" -maxdepth 1 \( -name '*-db.dump' -o -name '*-static.tar.gz' \) \
        -mtime +"${BACKUP_KEEP_DAYS}" -delete
    ls -lh "${BACKUP_DIR}/${ts}"-*
}

restore() {
    local ts="${1:?Usage: backup.sh restore <timestamp> (see: backup.sh list)}"
    local db="${BACKUP_DIR}/${ts}-db.dump" files="${BACKUP_DIR}/${ts}-static.tar.gz"
    [ -f "${db}" ] && [ -f "${files}" ] || { echo "Backup ${ts} not found" >&2; exit 1; }
    echo "==> Restoring database ${DB_NAME} from ${db}"
    # A fresh database: nothing created after the backup (e.g. by a module
    # installed later) survives. --force closes Medusa's open connections.
    dropdb --if-exists --force --maintenance-db=postgres "${DB_NAME}"
    createdb --maintenance-db=postgres "${DB_NAME}"
    pg_restore --no-owner --exit-on-error --dbname="${DB_NAME}" "${db}"
    echo "==> Restoring uploads from ${files}"
    mkdir -p "${UPLOADS}"
    find "${UPLOADS}" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
    tar -C "${UPLOADS}" -xzpf "${files}"
    chown -R "${APP_UID}:${APP_GID}" "${UPLOADS}"
    echo "==> Restored ${ts}"
}

case "${1:-loop}" in
    now) backup ;;
    list)
        for file in "${BACKUP_DIR}"/*-db.dump; do
            [ -e "${file}" ] && basename "${file}" -db.dump
        done | sort
        ;;
    restore) restore "${2:-}" ;;
    health)
        [ -n "$(find "${BACKUP_DIR}" -maxdepth 1 -name '*-db.dump' \
            -mmin -$(( BACKUP_INTERVAL_HOURS * 60 + 60 )) 2>/dev/null)" ]
        ;;
    loop)
        while :; do
            backup || echo "Backup failed" >&2
            sleep $(( BACKUP_INTERVAL_HOURS * 3600 ))
        done
        ;;
    *) echo "Unknown command: $1" >&2; exit 2 ;;
esac
