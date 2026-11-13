# Application logs of mizan.vertexmedia.pro only, named explicitly (copied from Vertex Hub's). nginx
# logs live in /var/log/nginx/mizan.vertexmedia.pro.*.log and /etc/logrotate.d/nginx rotates them
# (SERVER.md rule 9). The books' own history is the audit log in the database (ADR 0005), not these.
/var/log/mizan.vertexmedia.pro/api.*.log
/var/log/mizan.vertexmedia.pro/worker.*.log
{
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    copytruncate
    su vertexmizan vertexmizan
    create 0640 vertexmizan vertexmizan
}
