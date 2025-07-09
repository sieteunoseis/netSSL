#!/bin/sh

# Create the runtime config file
cat <<EOF > /usr/share/nginx/html/config.js
window.APP_CONFIG = {
  BRANDING_URL: "${VITE_BRANDING_URL:-https://automate.builders}",
  BRANDING_NAME: "${VITE_BRANDING_NAME:-Automate Builders}",
  TABLE_COLUMNS: "${VITE_TABLE_COLUMNS:-name,hostname,username,password,version}",
};
EOF

# Update nginx configuration with the correct backend host and port
sed -i "s/\${BACKEND_HOST}/${BACKEND_HOST:-backend}/g" /etc/nginx/conf.d/default.conf
sed -i "s/\${BACKEND_PORT}/${PORT:-3000}/g" /etc/nginx/conf.d/default.conf

echo "Generated config.js contents:"
cat /usr/share/nginx/html/config.js

echo "Updated nginx config:"
grep -A 10 "location /api/" /etc/nginx/conf.d/default.conf

echo "File permissions:"
ls -l /usr/share/nginx/html/config.js