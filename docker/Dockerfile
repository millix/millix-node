FROM node:12-alpine

RUN  apk update && \
     apk add --no-cache --virtual .build-deps-full \
     build-base \
     python2 \
     curl \
     wget \
     gcc \
     git
RUN  git clone https://github.com/millix/millix-node.git -b develop
WORKDIR /millix-node
RUN  npm install -g @babel/cli@7.8.4 @babel/core@7.8.4 @babel/node@7.8.4 && \
     npm install
ENV MILLIX_NODE_PASSWORD="millixpwd"
ENV MILLIX_NODE_PORT=30000
ENV MILLIX_NODE_PORT_API=5500
ENV MILLIX_NODE_DATA_FOLDER="./data/"
COPY run_node.sh run_node.sh
RUN  chmod +x run_node.sh
EXPOSE $MILLIX_NODE_PORT
EXPOSE $MILLIX_NODE_PORT_API
ENTRYPOINT [ "/bin/sh" ]
CMD [ "run_node.sh" ]


