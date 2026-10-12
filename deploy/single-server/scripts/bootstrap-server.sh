#!/bin/bash
# First-boot setup for Ubuntu 24.04, run once as root (Terraform passes it as user_data).
# Installs Docker and certbot, hardens SSH, enables the firewall and automatic security
# updates, adds swap, and schedules the nightly backup.
set -euxo pipefail
export DEBIAN_FRONTEND=noninteractive
DEPLOY_USER=ubuntu

apt-get update
apt-get -y upgrade
apt-get install -y ca-certificates curl ufw fail2ban unattended-upgrades certbot

# Docker Engine and the compose plugin from Docker's official apt repository.
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
usermod -aG docker "$DEPLOY_USER"

# App directories.
mkdir -p /opt/taskboard /var/www/certbot /var/backups/taskboard
chown -R "$DEPLOY_USER:$DEPLOY_USER" /opt/taskboard /var/backups/taskboard

# SSH: keys only, no root login.
cat > /etc/ssh/sshd_config.d/99-hardening.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
EOF
systemctl reload ssh

# Host firewall. The Lightsail firewall in front is the real perimeter, because
# Docker-published ports bypass ufw rules.
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

systemctl enable --now fail2ban

cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF

# 1 GB swap as a safety margin on a small instance.
if [ ! -f /swapfile ]; then
  fallocate -l 1G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# Nightly backup at 02:30 UTC. It fails harmlessly until the first deploy copies the scripts.
touch /var/log/taskboard-backup.log
chown "$DEPLOY_USER" /var/log/taskboard-backup.log
echo "30 2 * * * $DEPLOY_USER /opt/taskboard/scripts/backup.sh >> /var/log/taskboard-backup.log 2>&1" \
  > /etc/cron.d/taskboard-backup
