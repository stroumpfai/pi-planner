FROM python:3.12-slim

# Place the package under /code/mcp_server so that pyproject.toml's
# `where = [".."]` resolves to /code and finds the mcp_server package.
ARG APP_VERSION=1.9.0
LABEL version="${APP_VERSION}"
ENV APP_VERSION=${APP_VERSION}

WORKDIR /code/mcp_server

COPY . .

RUN pip install --no-cache-dir .

ENV PYTHONUNBUFFERED=1

# Unprivileged user; /data (OAuth token store) is a bind mount shared with the app
RUN useradd --system --uid 10001 --no-create-home app
USER 10001

EXPOSE 8080

CMD ["python", "-m", "mcp_server.server"]
