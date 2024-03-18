FROM marlon360/usd-from-gltf:latest

ENV NODE_ENV production
ENV APP_DIR /usr/app/gltf2usdz

WORKDIR ${APP_DIR}

RUN echo "deb http://deb.debian.org/debian buster main contrib non-free" > /etc/apt/sources.list && \
    echo "deb http://deb.debian.org/debian buster-updates main contrib non-free" >> /etc/apt/sources.list && \
    echo "deb http://deb.debian.org/debian buster-backports main contrib non-free" >> /etc/apt/sources.list && \
    echo "deb http://security.debian.org/debian-security/ buster/updates main contrib non-free" >> /etc/apt/sources.list

RUN apt-get update --allow-releaseinfo-change || echo "installed"
RUN apt-get install curl unzip -y

RUN curl -fsSL https://bun.sh/install | bash -s "bun-v1.0.32"
ENV BUN_INSTALL="$HOME/.bun" 
ENV PATH=$BUN_INSTALL/bin:$PATH 

COPY . .

EXPOSE 4000

RUN bun install

WORKDIR ${APP_DIR}/client

RUN bun run build

WORKDIR ${APP_DIR}/server

ENTRYPOINT ["bun", "run", "start"]