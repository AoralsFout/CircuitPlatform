#include "circuit/engine.hpp"
#include "circuit/protocol.hpp"
#include "circuit/request_handler.hpp"
#include "circuit/simulation.hpp"

#include <iostream>
#include <optional>
#include <string>

// 持续读取 JSON Lines 请求；每行只产生一行响应，便于 Electron 维护长连接。
int main() {
    const circuit::Engine engine;
    circuit::Circuit circuit;
    std::optional<circuit::Simulation> simulation;
    std::string line;

    while (std::getline(std::cin, line)) {
        const auto request = circuit::protocol::parseRequest(line);
        if (!request.has_value()) {
            std::cout << circuit::protocol::errorResponse(
                             "", "bad_json", "请求必须包含有效的 type 和 requestId")
                      << std::endl;
            continue;
        }

        std::cout << circuit::handleRequest(*request, engine, circuit, simulation) << std::endl;
    }

    return 0;
}
