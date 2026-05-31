FROM python:3.12-slim

# Place the package under /code/mcp_server so that pyproject.toml's
# `where = [".."]` resolves to /code and finds the mcp_server package.
WORKDIR /code/mcp_server

COPY . .

RUN pip install --no-cache-dir .

ENV PYTHONUNBUFFERED=1

EXPOSE 8080

CMD ["python", "-m", "mcp_server.server"]
