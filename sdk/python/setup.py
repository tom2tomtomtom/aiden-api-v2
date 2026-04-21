"""AIDEN Brain SDK setup."""

from setuptools import setup, find_packages

setup(
    name="aiden-brain",
    version="0.1.0",
    description="Python SDK for the AIDEN Brain API v2",
    author="Tom Hyde",
    author_email="tomh@redbaez.com",
    url="https://github.com/tom2tomtomtom/aiden-brain-api-v2",
    packages=find_packages(),
    python_requires=">=3.11",
    classifiers=[
        "Development Status :: 3 - Alpha",
        "Intended Audience :: Developers",
        "Programming Language :: Python :: 3.11",
        "Programming Language :: Python :: 3.12",
    ],
)
