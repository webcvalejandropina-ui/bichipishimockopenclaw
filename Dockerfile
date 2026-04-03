FROM caddy:2-alpine
WORKDIR /srv
COPY dist/ /srv/
COPY Caddyfile /etc/caddy/Caddyfile
EXPOSE 8080
