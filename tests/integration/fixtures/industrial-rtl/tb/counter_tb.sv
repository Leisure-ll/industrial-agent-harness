`timescale 1ns/1ps
module counter_tb;
  logic clk = 0;
  logic reset = 1;
  logic [3:0] count;
  counter dut(.clk(clk), .reset(reset), .count(count));
  always #5 clk = ~clk;
  initial begin
    #12; reset = 0;
    #40;
    assert(count == 4) else $fatal(1, "counter assertion failed");
    $finish;
  end
endmodule
