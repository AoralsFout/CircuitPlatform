#include "circuit/engine.hpp"

#include <iostream>
#include <string>

int main() {
    const circuit::Engine engine;
    std::string line;

    while (std::getline(std::cin, line)) {
        if (line.find("\"type\":\"health_check\"") != std::string::npos) {
            const auto status = engine.status();
            std::cout << "{\"type\":\"health_check_result\",\"requestId\":\"desktop-startup\",\"status\":\"ok\",\"engine\":\""
                      << status.name << " " << status.version << "\"}" << std::endl;
        } else {
            std::cout << "{\"type\":\"error\",\"message\":\"unsupported message\"}" << std::endl;
        }
    }

    return 0;
}
